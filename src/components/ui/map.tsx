"use client";

import MapLibreGL, { type PopupOptions, type MarkerOptions } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  X,
  Minus,
  Plus,
  Locate,
  Maximize,
  Loader2,
  MapPin,
  Waypoints,
  Circle,
  Square,
  Pentagon,
  PenLine,
  Trash2,
  Download,
  Upload,
  Settings,
  Layers,
  Save,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  TerraDraw,
  TerraDrawPointMode,
  TerraDrawLineStringMode,
  TerraDrawPolygonMode,
  TerraDrawRectangleMode,
  TerraDrawCircleMode,
  TerraDrawFreehandMode,
  TerraDrawSelectMode,
  type GeoJSONStoreFeatures,
} from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";

import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// ============================================================================
// IndexedDB helpers for feature persistence
// ============================================================================

const DB_NAME = "map-draw-features";
const DB_VERSION = 2;
const STORE_NAME = "features";
const MAPS_STORE_NAME = "maps";

type SavedMap = {
  id: string;
  name: string;
  features: GeoJSONStoreFeatures[];
  createdAt: number;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(MAPS_STORE_NAME)) {
        db.createObjectStore(MAPS_STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

async function saveFeaturesToDB(features: GeoJSONStoreFeatures[]): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    // Clear existing and save all features
    store.clear();
    features.forEach((feature) => {
      store.put({ id: feature.id, data: feature });
    });

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (error) {
    console.error("Failed to save features to IndexedDB:", error);
  }
}

async function loadFeaturesFromDB(): Promise<GeoJSONStoreFeatures[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close();
        const results = request.result as { id: string; data: GeoJSONStoreFeatures }[];
        resolve(results.map((r) => r.data));
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("Failed to load features from IndexedDB:", error);
    return [];
  }
}

// ============================================================================
// Multi-map IndexedDB functions
// ============================================================================

async function saveMapToDB(name: string, features: GeoJSONStoreFeatures[]): Promise<SavedMap | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(MAPS_STORE_NAME, "readwrite");
    const store = tx.objectStore(MAPS_STORE_NAME);

    // Remove the 'selected' property from features when saving
    const cleanedFeatures = features.map((f) => {
      const { selected: _, ...restProperties } = f.properties;
      return {
        ...f,
        properties: restProperties,
      };
    }) as GeoJSONStoreFeatures[];

    const savedMap: SavedMap = {
      id: crypto.randomUUID(),
      name,
      features: cleanedFeatures,
      createdAt: Date.now(),
    };

    store.put(savedMap);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve(savedMap);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (error) {
    console.error("Failed to save map to IndexedDB:", error);
    return null;
  }
}

async function getAllMapsFromDB(): Promise<SavedMap[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(MAPS_STORE_NAME, "readonly");
    const store = tx.objectStore(MAPS_STORE_NAME);
    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => {
        db.close();
        const maps = request.result as SavedMap[];
        // Sort by creation date, newest first
        resolve(maps.sort((a, b) => b.createdAt - a.createdAt));
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch (error) {
    console.error("Failed to load maps from IndexedDB:", error);
    return [];
  }
}

async function deleteMapFromDB(mapId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(MAPS_STORE_NAME, "readwrite");
    const store = tx.objectStore(MAPS_STORE_NAME);

    store.delete(mapId);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (error) {
    console.error("Failed to delete map from IndexedDB:", error);
  }
}

// Check document class for theme (works with next-themes, etc.)
function getDocumentTheme(): Theme | null {
  if (typeof document === "undefined") return null;
  if (document.documentElement.classList.contains("dark")) return "dark";
  if (document.documentElement.classList.contains("light")) return "light";
  return null;
}

// Get system preference
function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function useResolvedTheme(themeProp?: "light" | "dark"): "light" | "dark" {
  const [detectedTheme, setDetectedTheme] = useState<"light" | "dark">(
    () => getDocumentTheme() ?? getSystemTheme()
  );

  useEffect(() => {
    if (themeProp) return; // Skip detection if theme is provided via prop

    // Watch for document class changes (e.g., next-themes toggling dark class)
    const observer = new MutationObserver(() => {
      const docTheme = getDocumentTheme();
      if (docTheme) {
        setDetectedTheme(docTheme);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    // Also watch for system preference changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleSystemChange = (e: MediaQueryListEvent) => {
      // Only use system preference if no document class is set
      if (!getDocumentTheme()) {
        setDetectedTheme(e.matches ? "dark" : "light");
      }
    };
    mediaQuery.addEventListener("change", handleSystemChange);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", handleSystemChange);
    };
  }, [themeProp]);

  return themeProp ?? detectedTheme;
}

type MapContextValue = {
  map: MapLibreGL.Map | null;
  isLoaded: boolean;
};

const MapContext = createContext<MapContextValue | null>(null);

function useMap() {
  const context = useContext(MapContext);
  if (!context) {
    throw new Error("useMap must be used within a Map component");
  }
  return context;
}

const defaultStyles = {
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
};

type MapStyleOption = string | MapLibreGL.StyleSpecification;

type Theme = "light" | "dark";

type MapProps = {
  children?: ReactNode;
  /**
   * Theme for the map. If not provided, automatically detects system preference.
   * Pass your theme value here.
   */
  theme?: Theme;
  /** Custom map styles for light and dark themes. Overrides the default Carto styles. */
  styles?: {
    light?: MapStyleOption;
    dark?: MapStyleOption;
  };
  /** Map projection type. Use `{ type: "globe" }` for 3D globe view. */
  projection?: MapLibreGL.ProjectionSpecification;
} & Omit<MapLibreGL.MapOptions, "container" | "style">;

type MapRef = MapLibreGL.Map;

const DefaultLoader = () => (
  <div className="absolute inset-0 flex items-center justify-center">
    <div className="flex gap-1">
      <span className="size-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-pulse" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-pulse [animation-delay:150ms]" />
      <span className="size-1.5 rounded-full bg-muted-foreground/60 motion-safe:animate-pulse [animation-delay:300ms]" />
    </div>
  </div>
);

const Map = forwardRef<MapRef, MapProps>(function Map(
  { children, theme: themeProp, styles, projection, ...props },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mapInstance, setMapInstance] = useState<MapLibreGL.Map | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isStyleLoaded, setIsStyleLoaded] = useState(false);
  const currentStyleRef = useRef<MapStyleOption | null>(null);
  const styleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolvedTheme = useResolvedTheme(themeProp);

  const mapStyles = useMemo(
    () => ({
      dark: styles?.dark ?? defaultStyles.dark,
      light: styles?.light ?? defaultStyles.light,
    }),
    [styles]
  );

  useImperativeHandle(ref, () => mapInstance as MapLibreGL.Map, [mapInstance]);

  const clearStyleTimeout = useCallback(() => {
    if (styleTimeoutRef.current) {
      clearTimeout(styleTimeoutRef.current);
      styleTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const initialStyle =
      resolvedTheme === "dark" ? mapStyles.dark : mapStyles.light;
    currentStyleRef.current = initialStyle;

    const map = new MapLibreGL.Map({
      container: containerRef.current,
      style: initialStyle,
      renderWorldCopies: false,
      attributionControl: {
        compact: true,
      },
      ...props,
    });

    const styleDataHandler = () => {
      clearStyleTimeout();
      // Delay to ensure style is fully processed before allowing layer operations
      // This is a workaround to avoid race conditions with the style loading
      // else we have to force update every layer on setStyle change
      styleTimeoutRef.current = setTimeout(() => {
        setIsStyleLoaded(true);
        if (projection) {
          map.setProjection(projection);
        }
      }, 100);
    };
    const loadHandler = () => setIsLoaded(true);

    map.on("load", loadHandler);
    map.on("styledata", styleDataHandler);
    setMapInstance(map);

    return () => {
      clearStyleTimeout();
      map.off("load", loadHandler);
      map.off("styledata", styleDataHandler);
      map.remove();
      setIsLoaded(false);
      setIsStyleLoaded(false);
      setMapInstance(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapInstance || !resolvedTheme) return;

    const newStyle =
      resolvedTheme === "dark" ? mapStyles.dark : mapStyles.light;

    if (currentStyleRef.current === newStyle) return;

    clearStyleTimeout();
    currentStyleRef.current = newStyle;
    setIsStyleLoaded(false);

    mapInstance.setStyle(newStyle, { diff: true });
  }, [mapInstance, resolvedTheme, mapStyles, clearStyleTimeout]);

  const contextValue = useMemo(
    () => ({
      map: mapInstance,
      isLoaded: isLoaded && isStyleLoaded,
    }),
    [mapInstance, isLoaded, isStyleLoaded]
  );

  return (
    <MapContext.Provider value={contextValue}>
      <div ref={containerRef} className="relative w-full h-full">
        {!isLoaded && <DefaultLoader />}
        {/* SSR-safe: children render only when map is loaded on client */}
        {mapInstance && children}
      </div>
    </MapContext.Provider>
  );
});

type MarkerContextValue = {
  marker: MapLibreGL.Marker;
  map: MapLibreGL.Map | null;
};

const MarkerContext = createContext<MarkerContextValue | null>(null);

function useMarkerContext() {
  const context = useContext(MarkerContext);
  if (!context) {
    throw new Error("Marker components must be used within MapMarker");
  }
  return context;
}

type MapMarkerProps = {
  /** Longitude coordinate for marker position */
  longitude: number;
  /** Latitude coordinate for marker position */
  latitude: number;
  /** Marker subcomponents (MarkerContent, MarkerPopup, MarkerTooltip, MarkerLabel) */
  children: ReactNode;
  /** Callback when marker is clicked */
  onClick?: (e: MouseEvent) => void;
  /** Callback when mouse enters marker */
  onMouseEnter?: (e: MouseEvent) => void;
  /** Callback when mouse leaves marker */
  onMouseLeave?: (e: MouseEvent) => void;
  /** Callback when marker drag starts (requires draggable: true) */
  onDragStart?: (lngLat: { lng: number; lat: number }) => void;
  /** Callback during marker drag (requires draggable: true) */
  onDrag?: (lngLat: { lng: number; lat: number }) => void;
  /** Callback when marker drag ends (requires draggable: true) */
  onDragEnd?: (lngLat: { lng: number; lat: number }) => void;
} & Omit<MarkerOptions, "element">;

function MapMarker({
  longitude,
  latitude,
  children,
  onClick,
  onMouseEnter,
  onMouseLeave,
  onDragStart,
  onDrag,
  onDragEnd,
  draggable = false,
  ...markerOptions
}: MapMarkerProps) {
  const { map } = useMap();

  // Use refs to store the latest callback functions to avoid stale closures
  const callbacksRef = useRef({
    onClick,
    onMouseEnter,
    onMouseLeave,
    onDragStart,
    onDrag,
    onDragEnd,
  });

  // Keep refs updated with latest callbacks
  callbacksRef.current = {
    onClick,
    onMouseEnter,
    onMouseLeave,
    onDragStart,
    onDrag,
    onDragEnd,
  };

  const marker = useMemo(() => {
    const markerInstance = new MapLibreGL.Marker({
      ...markerOptions,
      element: document.createElement("div"),
      draggable,
    }).setLngLat([longitude, latitude]);

    const handleClick = (e: MouseEvent) => callbacksRef.current.onClick?.(e);
    const handleMouseEnter = (e: MouseEvent) => callbacksRef.current.onMouseEnter?.(e);
    const handleMouseLeave = (e: MouseEvent) => callbacksRef.current.onMouseLeave?.(e);

    markerInstance.getElement()?.addEventListener("click", handleClick);
    markerInstance
      .getElement()
      ?.addEventListener("mouseenter", handleMouseEnter);
    markerInstance
      .getElement()
      ?.addEventListener("mouseleave", handleMouseLeave);

    const handleDragStart = () => {
      const lngLat = markerInstance.getLngLat();
      callbacksRef.current.onDragStart?.({ lng: lngLat.lng, lat: lngLat.lat });
    };
    const handleDrag = () => {
      const lngLat = markerInstance.getLngLat();
      callbacksRef.current.onDrag?.({ lng: lngLat.lng, lat: lngLat.lat });
    };
    const handleDragEnd = () => {
      const lngLat = markerInstance.getLngLat();
      callbacksRef.current.onDragEnd?.({ lng: lngLat.lng, lat: lngLat.lat });
    };

    markerInstance.on("dragstart", handleDragStart);
    markerInstance.on("drag", handleDrag);
    markerInstance.on("dragend", handleDragEnd);

    return markerInstance;

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map) return;

    marker.addTo(map);

    return () => {
      marker.remove();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  if (
    marker.getLngLat().lng !== longitude ||
    marker.getLngLat().lat !== latitude
  ) {
    marker.setLngLat([longitude, latitude]);
  }
  if (marker.isDraggable() !== draggable) {
    marker.setDraggable(draggable);
  }

  const currentOffset = marker.getOffset();
  const newOffset = markerOptions.offset ?? [0, 0];
  const [newOffsetX, newOffsetY] = Array.isArray(newOffset)
    ? newOffset
    : [newOffset.x, newOffset.y];
  if (currentOffset.x !== newOffsetX || currentOffset.y !== newOffsetY) {
    marker.setOffset(newOffset);
  }

  if (marker.getRotation() !== markerOptions.rotation) {
    marker.setRotation(markerOptions.rotation ?? 0);
  }
  if (marker.getRotationAlignment() !== markerOptions.rotationAlignment) {
    marker.setRotationAlignment(markerOptions.rotationAlignment ?? "auto");
  }
  if (marker.getPitchAlignment() !== markerOptions.pitchAlignment) {
    marker.setPitchAlignment(markerOptions.pitchAlignment ?? "auto");
  }

  return (
    <MarkerContext.Provider value={{ marker, map }}>
      {children}
    </MarkerContext.Provider>
  );
}

type MarkerContentProps = {
  /** Custom marker content. Defaults to a blue dot if not provided */
  children?: ReactNode;
  /** Additional CSS classes for the marker container */
  className?: string;
};

function MarkerContent({ children, className }: MarkerContentProps) {
  const { marker } = useMarkerContext();

  return createPortal(
    <div className={cn("relative cursor-pointer", className)}>
      {children || <DefaultMarkerIcon />}
    </div>,
    marker.getElement()
  );
}

function DefaultMarkerIcon() {
  return (
    <div className="relative size-4 rounded-full border-2 border-white bg-blue-500 shadow-lg" />
  );
}

type MarkerPopupProps = {
  /** Popup content */
  children: ReactNode;
  /** Additional CSS classes for the popup container */
  className?: string;
  /** Show a close button in the popup (default: false) */
  closeButton?: boolean;
} & Omit<PopupOptions, "className" | "closeButton">;

function MarkerPopup({
  children,
  className,
  closeButton = false,
  ...popupOptions
}: MarkerPopupProps) {
  const { marker, map } = useMarkerContext();
  const container = useMemo(() => document.createElement("div"), []);
  const prevPopupOptions = useRef(popupOptions);

  const popup = useMemo(() => {
    const popupInstance = new MapLibreGL.Popup({
      offset: 16,
      ...popupOptions,
      closeButton: false,
    })
      .setMaxWidth("none")
      .setDOMContent(container);

    return popupInstance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map) return;

    popup.setDOMContent(container);
    marker.setPopup(popup);

    return () => {
      marker.setPopup(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  if (popup.isOpen()) {
    const prev = prevPopupOptions.current;

    if (prev.offset !== popupOptions.offset) {
      popup.setOffset(popupOptions.offset ?? 16);
    }
    if (prev.maxWidth !== popupOptions.maxWidth && popupOptions.maxWidth) {
      popup.setMaxWidth(popupOptions.maxWidth ?? "none");
    }

    prevPopupOptions.current = popupOptions;
  }

  const handleClose = () => popup.remove();

  return createPortal(
    <div
      className={cn(
        "relative rounded-md border bg-popover p-3 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95",
        className
      )}
    >
      {closeButton && (
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-1 right-1 z-10 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label="Close popup"
        >
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </button>
      )}
      {children}
    </div>,
    container
  );
}

type MarkerTooltipProps = {
  /** Tooltip content */
  children: ReactNode;
  /** Additional CSS classes for the tooltip container */
  className?: string;
} & Omit<PopupOptions, "className" | "closeButton" | "closeOnClick">;

function MarkerTooltip({
  children,
  className,
  ...popupOptions
}: MarkerTooltipProps) {
  const { marker, map } = useMarkerContext();
  const container = useMemo(() => document.createElement("div"), []);
  const prevTooltipOptions = useRef(popupOptions);

  const tooltip = useMemo(() => {
    const tooltipInstance = new MapLibreGL.Popup({
      offset: 16,
      ...popupOptions,
      closeOnClick: true,
      closeButton: false,
    }).setMaxWidth("none");

    return tooltipInstance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map) return;

    tooltip.setDOMContent(container);

    const handleMouseEnter = () => {
      tooltip.setLngLat(marker.getLngLat()).addTo(map);
    };
    const handleMouseLeave = () => tooltip.remove();

    marker.getElement()?.addEventListener("mouseenter", handleMouseEnter);
    marker.getElement()?.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      marker.getElement()?.removeEventListener("mouseenter", handleMouseEnter);
      marker.getElement()?.removeEventListener("mouseleave", handleMouseLeave);
      tooltip.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  if (tooltip.isOpen()) {
    const prev = prevTooltipOptions.current;

    if (prev.offset !== popupOptions.offset) {
      tooltip.setOffset(popupOptions.offset ?? 16);
    }
    if (prev.maxWidth !== popupOptions.maxWidth && popupOptions.maxWidth) {
      tooltip.setMaxWidth(popupOptions.maxWidth ?? "none");
    }

    prevTooltipOptions.current = popupOptions;
  }

  return createPortal(
    <div
      className={cn(
        "rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md animate-in fade-in-0 zoom-in-95",
        className
      )}
    >
      {children}
    </div>,
    container
  );
}

type MarkerLabelProps = {
  /** Label text content */
  children: ReactNode;
  /** Additional CSS classes for the label */
  className?: string;
  /** Position of the label relative to the marker (default: "top") */
  position?: "top" | "bottom";
};

function MarkerLabel({
  children,
  className,
  position = "top",
}: MarkerLabelProps) {
  const positionClasses = {
    top: "bottom-full mb-1",
    bottom: "top-full mt-1",
  };

  return (
    <div
      className={cn(
        "absolute left-1/2 -translate-x-1/2 whitespace-nowrap",
        "text-[10px] font-medium text-foreground",
        positionClasses[position],
        className
      )}
    >
      {children}
    </div>
  );
}

type MapControlsProps = {
  /** Position of the controls on the map (default: "bottom-right") */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Show zoom in/out buttons (default: true) */
  showZoom?: boolean;
  /** Show compass button to reset bearing (default: false) */
  showCompass?: boolean;
  /** Show locate button to find user's location (default: false) */
  showLocate?: boolean;
  /** Show fullscreen toggle button (default: false) */
  showFullscreen?: boolean;
  /** Additional CSS classes for the controls container */
  className?: string;
  /** Callback with user coordinates when located */
  onLocate?: (coords: { longitude: number; latitude: number }) => void;
};

const positionClasses = {
  "top-left": "top-2 left-2",
  "top-right": "top-2 right-2",
  "bottom-left": "bottom-2 left-2",
  "bottom-right": "bottom-10 right-2",
};

function ControlGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col rounded-md border border-border bg-background shadow-sm overflow-hidden [&>button:not(:last-child)]:border-b [&>button:not(:last-child)]:border-border">
      {children}
    </div>
  );
}

function ControlButton({
  onClick,
  label,
  children,
  disabled = false,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      type="button"
      className={cn(
        "flex items-center justify-center size-8 hover:bg-accent dark:hover:bg-accent/40 transition-colors",
        disabled && "opacity-50 pointer-events-none cursor-not-allowed"
      )}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function MapControls({
  position = "bottom-right",
  showZoom = true,
  showCompass = false,
  showLocate = false,
  showFullscreen = false,
  className,
  onLocate,
}: MapControlsProps) {
  const { map } = useMap();
  const [waitingForLocation, setWaitingForLocation] = useState(false);

  const handleZoomIn = useCallback(() => {
    map?.zoomTo(map.getZoom() + 1, { duration: 300 });
  }, [map]);

  const handleZoomOut = useCallback(() => {
    map?.zoomTo(map.getZoom() - 1, { duration: 300 });
  }, [map]);

  const handleResetBearing = useCallback(() => {
    map?.resetNorthPitch({ duration: 300 });
  }, [map]);

  const handleLocate = useCallback(() => {
    setWaitingForLocation(true);
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const coords = {
            longitude: pos.coords.longitude,
            latitude: pos.coords.latitude,
          };
          map?.flyTo({
            center: [coords.longitude, coords.latitude],
            zoom: 14,
            duration: 1500,
          });
          onLocate?.(coords);
          setWaitingForLocation(false);
        },
        (error) => {
          console.error("Error getting location:", error);
          setWaitingForLocation(false);
        }
      );
    }
  }, [map, onLocate]);

  const handleFullscreen = useCallback(() => {
    const container = map?.getContainer();
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      container.requestFullscreen();
    }
  }, [map]);

  return (
    <div
      className={cn(
        "absolute z-10 flex flex-col gap-1.5",
        positionClasses[position],
        className
      )}
    >
      {showZoom && (
        <ControlGroup>
          <ControlButton onClick={handleZoomIn} label="Zoom in">
            <Plus className="size-4" />
          </ControlButton>
          <ControlButton onClick={handleZoomOut} label="Zoom out">
            <Minus className="size-4" />
          </ControlButton>
        </ControlGroup>
      )}
      {showCompass && (
        <ControlGroup>
          <CompassButton onClick={handleResetBearing} />
        </ControlGroup>
      )}
      {showLocate && (
        <ControlGroup>
          <ControlButton
            onClick={handleLocate}
            label="Find my location"
            disabled={waitingForLocation}
          >
            {waitingForLocation ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Locate className="size-4" />
            )}
          </ControlButton>
        </ControlGroup>
      )}
      {showFullscreen && (
        <ControlGroup>
          <ControlButton onClick={handleFullscreen} label="Toggle fullscreen">
            <Maximize className="size-4" />
          </ControlButton>
        </ControlGroup>
      )}
    </div>
  );
}

function CompassButton({ onClick }: { onClick: () => void }) {
  const { map } = useMap();
  const compassRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!map || !compassRef.current) return;

    const compass = compassRef.current;

    const updateRotation = () => {
      const bearing = map.getBearing();
      const pitch = map.getPitch();
      compass.style.transform = `rotateX(${pitch}deg) rotateZ(${-bearing}deg)`;
    };

    map.on("rotate", updateRotation);
    map.on("pitch", updateRotation);
    updateRotation();

    return () => {
      map.off("rotate", updateRotation);
      map.off("pitch", updateRotation);
    };
  }, [map]);

  return (
    <ControlButton onClick={onClick} label="Reset bearing to north">
      <svg
        ref={compassRef}
        viewBox="0 0 24 24"
        className="size-5 transition-transform duration-200"
        style={{ transformStyle: "preserve-3d" }}
      >
        <path d="M12 2L16 12H12V2Z" className="fill-red-500" />
        <path d="M12 2L8 12H12V2Z" className="fill-red-300" />
        <path d="M12 22L16 12H12V22Z" className="fill-muted-foreground/60" />
        <path d="M12 22L8 12H12V22Z" className="fill-muted-foreground/30" />
      </svg>
    </ControlButton>
  );
}

type MapPopupProps = {
  /** Longitude coordinate for popup position */
  longitude: number;
  /** Latitude coordinate for popup position */
  latitude: number;
  /** Callback when popup is closed */
  onClose?: () => void;
  /** Popup content */
  children: ReactNode;
  /** Additional CSS classes for the popup container */
  className?: string;
  /** Show a close button in the popup (default: false) */
  closeButton?: boolean;
} & Omit<PopupOptions, "className" | "closeButton">;

function MapPopup({
  longitude,
  latitude,
  onClose,
  children,
  className,
  closeButton = false,
  ...popupOptions
}: MapPopupProps) {
  const { map } = useMap();
  const popupOptionsRef = useRef(popupOptions);
  const container = useMemo(() => document.createElement("div"), []);

  const popup = useMemo(() => {
    const popupInstance = new MapLibreGL.Popup({
      offset: 16,
      ...popupOptions,
      closeButton: false,
    })
      .setMaxWidth("none")
      .setLngLat([longitude, latitude]);

    return popupInstance;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!map) return;

    const onCloseProp = () => onClose?.();
    popup.on("close", onCloseProp);

    popup.setDOMContent(container);
    popup.addTo(map);

    return () => {
      popup.off("close", onCloseProp);
      if (popup.isOpen()) {
        popup.remove();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  if (popup.isOpen()) {
    const prev = popupOptionsRef.current;

    if (
      popup.getLngLat().lng !== longitude ||
      popup.getLngLat().lat !== latitude
    ) {
      popup.setLngLat([longitude, latitude]);
    }

    if (prev.offset !== popupOptions.offset) {
      popup.setOffset(popupOptions.offset ?? 16);
    }
    if (prev.maxWidth !== popupOptions.maxWidth && popupOptions.maxWidth) {
      popup.setMaxWidth(popupOptions.maxWidth ?? "none");
    }
    popupOptionsRef.current = popupOptions;
  }

  const handleClose = () => {
    popup.remove();
    onClose?.();
  };

  return createPortal(
    <div
      className={cn(
        "relative rounded-md border bg-popover p-3 text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95",
        className
      )}
    >
      {closeButton && (
        <button
          type="button"
          onClick={handleClose}
          className="absolute top-1 right-1 z-10 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          aria-label="Close popup"
        >
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </button>
      )}
      {children}
    </div>,
    container
  );
}

type MapRouteProps = {
  /** Optional unique identifier for the route layer */
  id?: string;
  /** Array of [longitude, latitude] coordinate pairs defining the route */
  coordinates: [number, number][];
  /** Line color as CSS color value (default: "#4285F4") */
  color?: string;
  /** Line width in pixels (default: 3) */
  width?: number;
  /** Line opacity from 0 to 1 (default: 0.8) */
  opacity?: number;
  /** Dash pattern [dash length, gap length] for dashed lines */
  dashArray?: [number, number];
  /** Callback when the route line is clicked */
  onClick?: () => void;
  /** Callback when mouse enters the route line */
  onMouseEnter?: () => void;
  /** Callback when mouse leaves the route line */
  onMouseLeave?: () => void;
  /** Whether the route is interactive - shows pointer cursor on hover (default: true) */
  interactive?: boolean;
};

function MapRoute({
  id: propId,
  coordinates,
  color = "#4285F4",
  width = 3,
  opacity = 0.8,
  dashArray,
  onClick,
  onMouseEnter,
  onMouseLeave,
  interactive = true,
}: MapRouteProps) {
  const { map, isLoaded } = useMap();
  const autoId = useId();
  const id = propId ?? autoId;
  const sourceId = `route-source-${id}`;
  const layerId = `route-layer-${id}`;

  // Add source and layer on mount
  useEffect(() => {
    if (!isLoaded || !map) return;

    map.addSource(sourceId, {
      type: "geojson",
      data: {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [] },
      },
    });

    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": color,
        "line-width": width,
        "line-opacity": opacity,
        ...(dashArray && { "line-dasharray": dashArray }),
      },
    });

    return () => {
      try {
        if (map.getLayer(layerId)) map.removeLayer(layerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map]);

  // When coordinates change, update the source data
  useEffect(() => {
    if (!isLoaded || !map || coordinates.length < 2) return;

    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource;
    if (source) {
      source.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      });
    }
  }, [isLoaded, map, coordinates, sourceId]);

  useEffect(() => {
    if (!isLoaded || !map || !map.getLayer(layerId)) return;

    map.setPaintProperty(layerId, "line-color", color);
    map.setPaintProperty(layerId, "line-width", width);
    map.setPaintProperty(layerId, "line-opacity", opacity);
    if (dashArray) {
      map.setPaintProperty(layerId, "line-dasharray", dashArray);
    }
  }, [isLoaded, map, layerId, color, width, opacity, dashArray]);

  // Handle click and hover events
  useEffect(() => {
    if (!isLoaded || !map || !interactive) return;

    const handleClick = () => {
      onClick?.();
    };
    const handleMouseEnter = () => {
      map.getCanvas().style.cursor = "pointer";
      onMouseEnter?.();
    };
    const handleMouseLeave = () => {
      map.getCanvas().style.cursor = "";
      onMouseLeave?.();
    };

    map.on("click", layerId, handleClick);
    map.on("mouseenter", layerId, handleMouseEnter);
    map.on("mouseleave", layerId, handleMouseLeave);

    return () => {
      map.off("click", layerId, handleClick);
      map.off("mouseenter", layerId, handleMouseEnter);
      map.off("mouseleave", layerId, handleMouseLeave);
    };
  }, [
    isLoaded,
    map,
    layerId,
    onClick,
    onMouseEnter,
    onMouseLeave,
    interactive,
  ]);

  return null;
}

type MapClusterLayerProps<
  P extends GeoJSON.GeoJsonProperties = GeoJSON.GeoJsonProperties
> = {
  /** GeoJSON FeatureCollection data or URL to fetch GeoJSON from */
  data: string | GeoJSON.FeatureCollection<GeoJSON.Point, P>;
  /** Maximum zoom level to cluster points on (default: 14) */
  clusterMaxZoom?: number;
  /** Radius of each cluster when clustering points in pixels (default: 50) */
  clusterRadius?: number;
  /** Colors for cluster circles: [small, medium, large] based on point count (default: ["#51bbd6", "#f1f075", "#f28cb1"]) */
  clusterColors?: [string, string, string];
  /** Point count thresholds for color/size steps: [medium, large] (default: [100, 750]) */
  clusterThresholds?: [number, number];
  /** Color for unclustered individual points (default: "#3b82f6") */
  pointColor?: string;
  /** Callback when an unclustered point is clicked */
  onPointClick?: (
    feature: GeoJSON.Feature<GeoJSON.Point, P>,
    coordinates: [number, number]
  ) => void;
  /** Callback when a cluster is clicked. If not provided, zooms into the cluster */
  onClusterClick?: (
    clusterId: number,
    coordinates: [number, number],
    pointCount: number
  ) => void;
};

function MapClusterLayer<
  P extends GeoJSON.GeoJsonProperties = GeoJSON.GeoJsonProperties
>({
  data,
  clusterMaxZoom = 14,
  clusterRadius = 50,
  clusterColors = ["#51bbd6", "#f1f075", "#f28cb1"],
  clusterThresholds = [100, 750],
  pointColor = "#3b82f6",
  onPointClick,
  onClusterClick,
}: MapClusterLayerProps<P>) {
  const { map, isLoaded } = useMap();
  const id = useId();
  const sourceId = `cluster-source-${id}`;
  const clusterLayerId = `clusters-${id}`;
  const clusterCountLayerId = `cluster-count-${id}`;
  const unclusteredLayerId = `unclustered-point-${id}`;

  const stylePropsRef = useRef({
    clusterColors,
    clusterThresholds,
    pointColor,
  });

  // Add source and layers on mount
  useEffect(() => {
    if (!isLoaded || !map) return;

    // Add clustered GeoJSON source
    map.addSource(sourceId, {
      type: "geojson",
      data,
      cluster: true,
      clusterMaxZoom,
      clusterRadius,
    });

    // Add cluster circles layer
    map.addLayer({
      id: clusterLayerId,
      type: "circle",
      source: sourceId,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step",
          ["get", "point_count"],
          clusterColors[0],
          clusterThresholds[0],
          clusterColors[1],
          clusterThresholds[1],
          clusterColors[2],
        ],
        "circle-radius": [
          "step",
          ["get", "point_count"],
          20,
          clusterThresholds[0],
          30,
          clusterThresholds[1],
          40,
        ],
      },
    });

    // Add cluster count text layer
    map.addLayer({
      id: clusterCountLayerId,
      type: "symbol",
      source: sourceId,
      filter: ["has", "point_count"],
      layout: {
        "text-field": "{point_count_abbreviated}",
        "text-size": 12,
      },
      paint: {
        "text-color": "#fff",
      },
    });

    // Add unclustered point layer
    map.addLayer({
      id: unclusteredLayerId,
      type: "circle",
      source: sourceId,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": pointColor,
        "circle-radius": 6,
      },
    });

    return () => {
      try {
        if (map.getLayer(clusterCountLayerId))
          map.removeLayer(clusterCountLayerId);
        if (map.getLayer(unclusteredLayerId))
          map.removeLayer(unclusteredLayerId);
        if (map.getLayer(clusterLayerId)) map.removeLayer(clusterLayerId);
        if (map.getSource(sourceId)) map.removeSource(sourceId);
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map, sourceId]);

  // Update source data when data prop changes (only for non-URL data)
  useEffect(() => {
    if (!isLoaded || !map || typeof data === "string") return;

    const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource;
    if (source) {
      source.setData(data);
    }
  }, [isLoaded, map, data, sourceId]);

  // Update layer styles when props change
  useEffect(() => {
    if (!isLoaded || !map) return;

    const prev = stylePropsRef.current;
    const colorsChanged =
      prev.clusterColors !== clusterColors ||
      prev.clusterThresholds !== clusterThresholds;

    // Update cluster layer colors and sizes
    if (map.getLayer(clusterLayerId) && colorsChanged) {
      map.setPaintProperty(clusterLayerId, "circle-color", [
        "step",
        ["get", "point_count"],
        clusterColors[0],
        clusterThresholds[0],
        clusterColors[1],
        clusterThresholds[1],
        clusterColors[2],
      ]);
      map.setPaintProperty(clusterLayerId, "circle-radius", [
        "step",
        ["get", "point_count"],
        20,
        clusterThresholds[0],
        30,
        clusterThresholds[1],
        40,
      ]);
    }

    // Update unclustered point layer color
    if (map.getLayer(unclusteredLayerId) && prev.pointColor !== pointColor) {
      map.setPaintProperty(unclusteredLayerId, "circle-color", pointColor);
    }

    stylePropsRef.current = { clusterColors, clusterThresholds, pointColor };
  }, [
    isLoaded,
    map,
    clusterLayerId,
    unclusteredLayerId,
    clusterColors,
    clusterThresholds,
    pointColor,
  ]);

  // Handle click events
  useEffect(() => {
    if (!isLoaded || !map) return;

    // Cluster click handler - zoom into cluster
    const handleClusterClick = async (
      e: MapLibreGL.MapMouseEvent & {
        features?: MapLibreGL.MapGeoJSONFeature[];
      }
    ) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [clusterLayerId],
      });
      if (!features.length) return;

      const feature = features[0];
      const clusterId = feature.properties?.cluster_id as number;
      const pointCount = feature.properties?.point_count as number;
      const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [
        number,
        number
      ];

      if (onClusterClick) {
        onClusterClick(clusterId, coordinates, pointCount);
      } else {
        // Default behavior: zoom to cluster expansion zoom
        const source = map.getSource(sourceId) as MapLibreGL.GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(clusterId);
        map.easeTo({
          center: coordinates,
          zoom,
        });
      }
    };

    // Unclustered point click handler
    const handlePointClick = (
      e: MapLibreGL.MapMouseEvent & {
        features?: MapLibreGL.MapGeoJSONFeature[];
      }
    ) => {
      if (!onPointClick || !e.features?.length) return;

      const feature = e.features[0];
      const coordinates = (
        feature.geometry as GeoJSON.Point
      ).coordinates.slice() as [number, number];

      // Handle world copies
      while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
        coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
      }

      onPointClick(
        feature as unknown as GeoJSON.Feature<GeoJSON.Point, P>,
        coordinates
      );
    };

    // Cursor style handlers
    const handleMouseEnterCluster = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const handleMouseLeaveCluster = () => {
      map.getCanvas().style.cursor = "";
    };
    const handleMouseEnterPoint = () => {
      if (onPointClick) {
        map.getCanvas().style.cursor = "pointer";
      }
    };
    const handleMouseLeavePoint = () => {
      map.getCanvas().style.cursor = "";
    };

    map.on("click", clusterLayerId, handleClusterClick);
    map.on("click", unclusteredLayerId, handlePointClick);
    map.on("mouseenter", clusterLayerId, handleMouseEnterCluster);
    map.on("mouseleave", clusterLayerId, handleMouseLeaveCluster);
    map.on("mouseenter", unclusteredLayerId, handleMouseEnterPoint);
    map.on("mouseleave", unclusteredLayerId, handleMouseLeavePoint);

    return () => {
      map.off("click", clusterLayerId, handleClusterClick);
      map.off("click", unclusteredLayerId, handlePointClick);
      map.off("mouseenter", clusterLayerId, handleMouseEnterCluster);
      map.off("mouseleave", clusterLayerId, handleMouseLeaveCluster);
      map.off("mouseenter", unclusteredLayerId, handleMouseEnterPoint);
      map.off("mouseleave", unclusteredLayerId, handleMouseLeavePoint);
    };
  }, [
    isLoaded,
    map,
    clusterLayerId,
    unclusteredLayerId,
    sourceId,
    onClusterClick,
    onPointClick,
  ]);

  return null;
}

// ============================================================================
// Draw Controls
// ============================================================================

type DrawMode =
  | "point"
  | "linestring"
  | "polygon"
  | "rectangle"
  | "circle"
  | "freehand"
  | "select"
  | null;

type DrawContextValue = {
  terraDraw: TerraDraw | null;
  activeMode: DrawMode;
  setActiveMode: (mode: DrawMode) => void;
  features: GeoJSONStoreFeatures[];
  // Multi-map support
  savedMaps: SavedMap[];
  loadedMapIds: Set<string>;
  saveCurrentAsMap: (name: string) => Promise<void>;
  toggleMap: (mapId: string) => void;
  deleteMap: (mapId: string) => Promise<void>;
  refreshMaps: () => Promise<void>;
};

const DrawContext = createContext<DrawContextValue | null>(null);

function useDrawContext() {
  const context = useContext(DrawContext);
  if (!context) {
    throw new Error("Draw components must be used within MapDrawControl");
  }
  return context;
}

type MapDrawControlProps = {
  /** Position of the draw controls on the map (default: "bottom-left") */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Additional CSS classes for the controls container */
  className?: string;
  /** Callback when features change */
  onFeaturesChange?: (features: GeoJSONStoreFeatures[]) => void;
  /** Draw control buttons */
  children?: ReactNode;
};

function MapDrawControl({
  position = "bottom-left",
  className,
  onFeaturesChange,
  children,
}: MapDrawControlProps) {
  const { map, isLoaded } = useMap();
  const [terraDraw, setTerraDraw] = useState<TerraDraw | null>(null);
  const [activeMode, setActiveMode] = useState<DrawMode>(null);
  const [features, setFeatures] = useState<GeoJSONStoreFeatures[]>([]);
  const hasLoadedFromDB = useRef(false);

  // Multi-map support
  const [savedMaps, setSavedMaps] = useState<SavedMap[]>([]);
  const [loadedMapIds, setLoadedMapIds] = useState<Set<string>>(new Set());
  // Track which feature IDs belong to which loaded map
  // Using globalThis.Map to avoid conflict with the Map component
  const loadedMapFeaturesRef = useRef<globalThis.Map<string, string[]>>(new globalThis.Map());

  // Load saved maps list on mount
  useEffect(() => {
    getAllMapsFromDB().then(setSavedMaps);
  }, []);

  useEffect(() => {
    if (!isLoaded || !map) return;

    const draw = new TerraDraw({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPointMode(),
        new TerraDrawLineStringMode(),
        new TerraDrawPolygonMode(),
        new TerraDrawRectangleMode(),
        new TerraDrawCircleMode(),
        new TerraDrawFreehandMode(),
        new TerraDrawSelectMode({
          flags: {
            point: { feature: { draggable: true } },
            linestring: {
              feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } },
            },
            polygon: {
              feature: { draggable: true, coordinates: { midpoints: true, draggable: true, deletable: true } },
            },
            rectangle: {
              feature: { draggable: true, coordinates: { draggable: true } },
            },
            circle: {
              feature: { draggable: true, coordinates: { draggable: true } },
            },
            freehand: {
              feature: { draggable: true },
            },
          },
        }),
      ],
    });

    draw.start();

    // Auto-load features from IndexedDB on mount
    if (!hasLoadedFromDB.current) {
      hasLoadedFromDB.current = true;
      loadFeaturesFromDB().then((savedFeatures) => {
        if (savedFeatures.length > 0) {
          draw.addFeatures(savedFeatures);
        }
      });
    }

    draw.on("change", () => {
      const snapshot = draw.getSnapshot();
      setFeatures(snapshot);
      onFeaturesChange?.(snapshot);
      // Auto-save to IndexedDB
      saveFeaturesToDB(snapshot);
    });

    setTerraDraw(draw);

    return () => {
      draw.stop();
      setTerraDraw(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, map]);

  const handleSetActiveMode = useCallback(
    (mode: DrawMode) => {
      if (!terraDraw) return;

      if (mode === activeMode || mode === null) {
        terraDraw.setMode("static");
        setActiveMode(null);
      } else {
        terraDraw.setMode(mode);
        setActiveMode(mode);
      }
    },
    [terraDraw, activeMode]
  );

  const refreshMaps = useCallback(async () => {
    const maps = await getAllMapsFromDB();
    setSavedMaps(maps);
  }, []);

  const saveCurrentAsMap = useCallback(
    async (name: string) => {
      if (!terraDraw || features.length === 0) return;
      await saveMapToDB(name, features);
      await refreshMaps();
    },
    [terraDraw, features, refreshMaps]
  );

  const toggleMap = useCallback(
    (mapId: string) => {
      if (!terraDraw) return;

      const isCurrentlyLoaded = loadedMapIds.has(mapId);

      if (isCurrentlyLoaded) {
        // Remove the map's features
        const featureIds = loadedMapFeaturesRef.current.get(mapId) || [];
        if (featureIds.length > 0) {
          terraDraw.removeFeatures(featureIds);
        }
        loadedMapFeaturesRef.current.delete(mapId);
        setLoadedMapIds((prev) => {
          const next = new Set(prev);
          next.delete(mapId);
          return next;
        });
      } else {
        // Add the map's features
        const savedMap = savedMaps.find((m) => m.id === mapId);
        if (savedMap && savedMap.features.length > 0) {
          // Add features and track their new IDs
          const addedIds: string[] = [];
          savedMap.features.forEach((feature) => {
            const newId = crypto.randomUUID();
            terraDraw.addFeatures([
              {
                ...feature,
                id: newId,
              },
            ]);
            addedIds.push(newId);
          });
          loadedMapFeaturesRef.current.set(mapId, addedIds);
          setLoadedMapIds((prev) => new Set(prev).add(mapId));
        }
      }
    },
    [terraDraw, loadedMapIds, savedMaps]
  );

  const deleteMap = useCallback(
    async (mapId: string) => {
      // If the map is loaded, unload it first
      if (loadedMapIds.has(mapId)) {
        toggleMap(mapId);
      }
      await deleteMapFromDB(mapId);
      await refreshMaps();
    },
    [loadedMapIds, toggleMap, refreshMaps]
  );

  const contextValue = useMemo(
    () => ({
      terraDraw,
      activeMode,
      setActiveMode: handleSetActiveMode,
      features,
      savedMaps,
      loadedMapIds,
      saveCurrentAsMap,
      toggleMap,
      deleteMap,
      refreshMaps,
    }),
    [terraDraw, activeMode, handleSetActiveMode, features, savedMaps, loadedMapIds, saveCurrentAsMap, toggleMap, deleteMap, refreshMaps]
  );

  return (
    <DrawContext.Provider value={contextValue}>
      <div
        className={cn(
          "absolute z-10 flex flex-col gap-1.5",
          positionClasses[position],
          className
        )}
      >
        {children}
      </div>
    </DrawContext.Provider>
  );
}

type MapDrawModesProps = {
  /** Draw mode buttons */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
};

function MapDrawModes({ children, className }: MapDrawModesProps) {
  return (
    <ControlGroup>
      <div className={cn("flex flex-col", className)}>{children}</div>
    </ControlGroup>
  );
}

type MapDrawToolbarProps = {
  /** Draw tool buttons to show in the expanded panel */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
};

function MapDrawToolbar({ children, className }: MapDrawToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { terraDraw } = useDrawContext();
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });

  // Update panel position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPosition({
        top: rect.bottom - rect.height, // Align bottom of panel with bottom of button
        left: rect.right + 8, // 8px gap to the right
      });
    }
  }, [isOpen]);

  // Close panel when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        isOpen &&
        panelRef.current &&
        buttonRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className={cn("relative", className)}>
      <ControlGroup>
        <button
          ref={buttonRef}
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Drawing tools"
          aria-expanded={isOpen}
          type="button"
          disabled={!terraDraw}
          className={cn(
            "flex items-center justify-center size-8 transition-colors",
            isOpen
              ? "bg-primary text-primary-foreground"
              : "hover:bg-accent dark:hover:bg-accent/40",
            !terraDraw && "opacity-50 pointer-events-none cursor-not-allowed"
          )}
        >
          <Settings className="size-4" />
        </button>
      </ControlGroup>
      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: panelPosition.top,
              left: panelPosition.left,
              transform: "translateY(-100%) translateY(32px)", // Align bottom with button bottom
            }}
            className="z-50 rounded-md border border-border bg-background shadow-md overflow-hidden"
          >
            <div className="flex flex-col [&>button]:border-0 [&>button:not(:last-child)]:border-b [&>button]:border-border">
              {children}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

type DrawModeButtonProps = {
  mode: DrawMode;
  label: string;
  children: ReactNode;
};

function DrawModeButton({ mode, label, children }: DrawModeButtonProps) {
  const { activeMode, setActiveMode, terraDraw } = useDrawContext();
  const isActive = activeMode === mode;

  return (
    <button
      onClick={() => setActiveMode(mode)}
      aria-label={label}
      type="button"
      disabled={!terraDraw}
      className={cn(
        "flex items-center justify-center size-8 transition-colors",
        isActive
          ? "bg-primary text-primary-foreground"
          : "hover:bg-accent dark:hover:bg-accent/40",
        !terraDraw && "opacity-50 pointer-events-none cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

function MapDrawPoint() {
  return (
    <DrawModeButton mode="point" label="Draw point">
      <MapPin className="size-4" />
    </DrawModeButton>
  );
}

function MapDrawLine() {
  return (
    <DrawModeButton mode="linestring" label="Draw line">
      <Waypoints className="size-4" />
    </DrawModeButton>
  );
}

function MapDrawPolygon() {
  return (
    <DrawModeButton mode="polygon" label="Draw polygon">
      <Pentagon className="size-4" />
    </DrawModeButton>
  );
}

function MapDrawRectangle() {
  return (
    <DrawModeButton mode="rectangle" label="Draw rectangle">
      <Square className="size-4" />
    </DrawModeButton>
  );
}

function MapDrawCircle() {
  return (
    <DrawModeButton mode="circle" label="Draw circle">
      <Circle className="size-4" />
    </DrawModeButton>
  );
}

function MapDrawFreehand() {
  return (
    <DrawModeButton mode="freehand" label="Draw freehand">
      <PenLine className="size-4" />
    </DrawModeButton>
  );
}

function MapDrawSelect() {
  return (
    <DrawModeButton mode="select" label="Select and edit">
      <PenLine className="size-4" />
    </DrawModeButton>
  );
}

function MapDrawDelete() {
  const { terraDraw, activeMode, setActiveMode, features } = useDrawContext();
  const hasFeatures = features.length > 0;

  // Check if we have selected features in select mode
  const selectedFeatures = activeMode === "select" && terraDraw
    ? terraDraw.getSnapshot().filter((f) => f.properties.selected)
    : [];
  const hasSelection = selectedFeatures.length > 0;

  const handleDeleteSelected = useCallback(() => {
    if (!terraDraw) return;
    selectedFeatures.forEach((f) => terraDraw.removeFeatures([f.id as string]));
  }, [terraDraw, selectedFeatures]);

  const handleClearAll = useCallback(() => {
    if (!terraDraw) return;
    terraDraw.clear();
    setActiveMode(null);
  }, [terraDraw, setActiveMode]);

  // If in select mode with selected features, delete without confirmation
  if (hasSelection) {
    return (
      <button
        onClick={handleDeleteSelected}
        aria-label="Delete selected features"
        type="button"
        disabled={!terraDraw}
        className={cn(
          "flex items-center justify-center size-8 transition-colors hover:bg-accent dark:hover:bg-accent/40",
          !terraDraw && "opacity-50 pointer-events-none cursor-not-allowed"
        )}
      >
        <Trash2 className="size-4" />
      </button>
    );
  }

  // Otherwise show confirmation dialog for clearing all
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button
          aria-label="Delete all features"
          type="button"
          disabled={!terraDraw || !hasFeatures}
          className={cn(
            "flex items-center justify-center size-8 transition-colors hover:bg-accent dark:hover:bg-accent/40",
            (!terraDraw || !hasFeatures) &&
              "opacity-50 pointer-events-none cursor-not-allowed"
          )}
        >
          <Trash2 className="size-4" />
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>Delete all features?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete all {features.length} drawn feature{features.length !== 1 ? "s" : ""} from the map.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleClearAll}>
            Delete all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function MapDrawDownload() {
  const { features } = useDrawContext();
  const hasFeatures = features.length > 0;

  const handleDownload = useCallback(() => {
    if (features.length === 0) return;

    const geojson = {
      type: "FeatureCollection",
      features: features.map((f) => {
        const { selected: _, ...properties } = f.properties;
        return {
          type: "Feature",
          geometry: f.geometry,
          properties,
        };
      }),
    };

    const blob = new Blob([JSON.stringify(geojson, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "drawn-features.geojson";
    a.click();
    URL.revokeObjectURL(url);
  }, [features]);

  return (
    <button
      onClick={handleDownload}
      aria-label="Download GeoJSON"
      type="button"
      disabled={!hasFeatures}
      className={cn(
        "flex items-center justify-center size-8 transition-colors hover:bg-accent dark:hover:bg-accent/40",
        !hasFeatures && "opacity-50 pointer-events-none cursor-not-allowed"
      )}
    >
      <Download className="size-4" />
    </button>
  );
}

function MapDrawImport() {
  const { terraDraw } = useDrawContext();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleImport = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !terraDraw) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const geojson = JSON.parse(content);

          // Handle both FeatureCollection and single Feature
          const features = geojson.type === "FeatureCollection"
            ? geojson.features
            : [geojson];

          // Add each feature to TerraDraw
          features.forEach((feature: GeoJSON.Feature) => {
            if (feature.geometry) {
              const geomType = feature.geometry.type;
              // Only support Point, LineString, and Polygon geometries
              if (geomType === "Point" || geomType === "LineString" || geomType === "Polygon") {
                const modeMap: Record<string, string> = {
                  Point: "point",
                  LineString: "linestring",
                  Polygon: "polygon",
                };
                terraDraw.addFeatures([
                  {
                    type: "Feature",
                    geometry: feature.geometry as GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon,
                    properties: { mode: modeMap[geomType] },
                  },
                ]);
              }
            }
          });
        } catch (error) {
          console.error("Failed to parse GeoJSON:", error);
        }
      };
      reader.readAsText(file);

      // Reset input so the same file can be selected again
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    },
    [terraDraw]
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".geojson,.json"
        onChange={handleImport}
        aria-label="Import GeoJSON file"
        className="hidden"
      />
      <button
        onClick={() => inputRef.current?.click()}
        aria-label="Import GeoJSON"
        type="button"
        disabled={!terraDraw}
        className={cn(
          "flex items-center justify-center size-8 transition-colors hover:bg-accent dark:hover:bg-accent/40",
          !terraDraw && "opacity-50 pointer-events-none cursor-not-allowed"
        )}
      >
        <Upload className="size-4" />
      </button>
    </>
  );
}

function MapDrawMapManager() {
  const {
    terraDraw,
    features,
    savedMaps,
    loadedMapIds,
    saveCurrentAsMap,
    toggleMap,
    deleteMap,
  } = useDrawContext();
  const [isOpen, setIsOpen] = useState(false);
  const [newMapName, setNewMapName] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [panelPosition, setPanelPosition] = useState({ top: 0, left: 0 });

  // Update panel position when opened
  useEffect(() => {
    if (isOpen && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPanelPosition({
        top: rect.top,
        left: rect.right + 8,
      });
    }
  }, [isOpen]);

  // Close panel when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        isOpen &&
        panelRef.current &&
        buttonRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleSave = async () => {
    if (!newMapName.trim() || features.length === 0) return;
    await saveCurrentAsMap(newMapName.trim());
    setNewMapName("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Manage saved maps"
        aria-expanded={isOpen}
        type="button"
        disabled={!terraDraw}
        className={cn(
          "flex items-center justify-center size-8 transition-colors",
          isOpen
            ? "bg-primary text-primary-foreground"
            : "hover:bg-accent dark:hover:bg-accent/40",
          !terraDraw && "opacity-50 pointer-events-none cursor-not-allowed"
        )}
      >
        <Layers className="size-4" />
      </button>
      {isOpen &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: "fixed",
              top: panelPosition.top,
              left: panelPosition.left,
            }}
            className="z-50 w-64 rounded-md border border-border bg-background shadow-md overflow-hidden"
          >
            <div className="p-3 border-b border-border">
              <div className="text-xs font-medium text-muted-foreground mb-2 text-balance">
                Save current as map
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newMapName}
                  onChange={(e) => setNewMapName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Map name..."
                  aria-label="Map name"
                  className="flex-1 h-7 px-2 text-sm rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <button
                  onClick={handleSave}
                  aria-label="Save map"
                  disabled={!newMapName.trim() || features.length === 0}
                  className={cn(
                    "h-7 px-2 rounded bg-primary text-primary-foreground text-sm hover:bg-primary/90 transition-colors",
                    (!newMapName.trim() || features.length === 0) &&
                      "opacity-50 cursor-not-allowed"
                  )}
                >
                  <Save className="size-3.5" />
                </button>
              </div>
            </div>
            <div className="max-h-48 overflow-y-auto">
              {savedMaps.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground text-center">
                  No saved maps yet
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {savedMaps.map((savedMap) => {
                    const isLoaded = loadedMapIds.has(savedMap.id);
                    return (
                      <div
                        key={savedMap.id}
                        className="flex items-center gap-2 p-2 hover:bg-accent/50"
                      >
                        <button
                          onClick={() => toggleMap(savedMap.id)}
                          aria-label={isLoaded ? "Hide map" : "Show map"}
                          className={cn(
                            "p-2 rounded transition-colors",
                            isLoaded
                              ? "text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          {isLoaded ? (
                            <Eye className="size-4" />
                          ) : (
                            <EyeOff className="size-4" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm truncate">{savedMap.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {savedMap.features.length} feature
                            {savedMap.features.length !== 1 ? "s" : ""}
                          </div>
                        </div>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <button
                              aria-label="Delete map"
                              className="p-2 rounded text-muted-foreground hover:text-destructive transition-colors"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </AlertDialogTrigger>
                          <AlertDialogContent size="sm">
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete "{savedMap.name}"?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete this saved map with {savedMap.features.length} feature{savedMap.features.length !== 1 ? "s" : ""}.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction variant="destructive" onClick={() => deleteMap(savedMap.id)}>
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

export {
  Map,
  useMap,
  MapMarker,
  MarkerContent,
  MarkerPopup,
  MarkerTooltip,
  MarkerLabel,
  MapPopup,
  MapControls,
  MapRoute,
  MapClusterLayer,
  // Draw controls
  MapDrawControl,
  MapDrawModes,
  MapDrawToolbar,
  MapDrawPoint,
  MapDrawLine,
  MapDrawPolygon,
  MapDrawRectangle,
  MapDrawCircle,
  MapDrawFreehand,
  MapDrawSelect,
  MapDrawDelete,
  MapDrawDownload,
  MapDrawImport,
  MapDrawMapManager,
  useDrawContext,
};

export type { MapRef, DrawMode };
