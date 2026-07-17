"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { MapMouseEvent } from "maplibre-gl";
import { ImagePlus, Minus, Plus, Trash2, Upload, X } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { MapMarker, MarkerContent, useMap } from "@/components/ui/map";
import { useTimelineOptional } from "@/components/ui/map-timeline";

// ============================================================================
// IndexedDB persistence for uploaded assets and placed instances
// ============================================================================

const DB_NAME = "map-assets";
const DB_VERSION = 1;
const ASSETS_STORE = "assets";
const PLACED_STORE = "placed";

type SvgAsset = {
  id: string;
  name: string;
  dataUrl: string;
};

type PlacedAsset = {
  id: string;
  assetId: string;
  longitude: number;
  latitude: number;
  /** Rendered width in screen pixels */
  width: number;
  /** Timeline step this instance appears on, or null to always show */
  step: number | null;
};

function openAssetsDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(ASSETS_STORE)) {
        db.createObjectStore(ASSETS_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(PLACED_STORE)) {
        db.createObjectStore(PLACED_STORE, { keyPath: "id" });
      }
    };
  });
}

async function loadAssetsFromDB(): Promise<{
  assets: SvgAsset[];
  placed: PlacedAsset[];
}> {
  try {
    const db = await openAssetsDB();
    const tx = db.transaction([ASSETS_STORE, PLACED_STORE], "readonly");
    const assetsRequest = tx.objectStore(ASSETS_STORE).getAll();
    const placedRequest = tx.objectStore(PLACED_STORE).getAll();

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve({
          assets: assetsRequest.result as SvgAsset[],
          placed: placedRequest.result as PlacedAsset[],
        });
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (error) {
    console.error("Failed to load assets from IndexedDB:", error);
    return { assets: [], placed: [] };
  }
}

async function saveAssetsToDB(
  assets: SvgAsset[],
  placed: PlacedAsset[]
): Promise<void> {
  try {
    const db = await openAssetsDB();
    const tx = db.transaction([ASSETS_STORE, PLACED_STORE], "readwrite");
    const assetsStore = tx.objectStore(ASSETS_STORE);
    const placedStore = tx.objectStore(PLACED_STORE);

    assetsStore.clear();
    assets.forEach((asset) => assetsStore.put(asset));
    placedStore.clear();
    placed.forEach((instance) => placedStore.put(instance));

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
    console.error("Failed to save assets to IndexedDB:", error);
  }
}

// ============================================================================
// Asset control
// ============================================================================

const MIN_WIDTH = 24;
const MAX_WIDTH = 512;
const DEFAULT_WIDTH = 96;

const positionClasses = {
  "top-left": "top-2 left-2",
  "top-right": "top-2 right-2",
  "bottom-left": "bottom-2 left-2",
  "bottom-right": "bottom-10 right-2",
};

function PanelButton({
  onClick,
  label,
  disabled = false,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      type="button"
      disabled={disabled}
      className={cn(
        "flex items-center justify-center size-6 rounded-sm hover:bg-accent dark:hover:bg-accent/40 transition-colors",
        disabled && "opacity-50 pointer-events-none cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

type MapAssetControlProps = {
  /** Position of the asset controls on the map (default: "top-right") */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Additional CSS classes for the controls container */
  className?: string;
};

function MapAssetControl({
  position = "top-right",
  className,
}: MapAssetControlProps) {
  const { map, isLoaded } = useMap();
  const timeline = useTimelineOptional();

  const [assets, setAssets] = useState<SvgAsset[]>([]);
  const [placed, setPlaced] = useState<PlacedAsset[]>([]);
  const [armedAssetId, setArmedAssetId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const hasLoadedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load persisted assets on mount
  useEffect(() => {
    loadAssetsFromDB().then((stored) => {
      setAssets(stored.assets);
      setPlaced(stored.placed);
      hasLoadedRef.current = true;
    });
  }, []);

  // Persist on change
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    saveAssetsToDB(assets, placed);
  }, [assets, placed]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        setAssets((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            name: file.name.replace(/\.svg$/i, ""),
            dataUrl: reader.result as string,
          },
        ]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  // Placement mode: next map click drops the armed asset
  useEffect(() => {
    if (!map || !isLoaded || !armedAssetId) return;

    const handleClick = (e: MapMouseEvent) => {
      const id = crypto.randomUUID();
      setPlaced((prev) => [
        ...prev,
        {
          id,
          assetId: armedAssetId,
          longitude: e.lngLat.lng,
          latitude: e.lngLat.lat,
          width: DEFAULT_WIDTH,
          step: null,
        },
      ]);
      setArmedAssetId(null);
      setSelectedId(id);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArmedAssetId(null);
    };

    const canvas = map.getCanvas();
    const previousCursor = canvas.style.cursor;
    canvas.style.cursor = "crosshair";
    map.on("click", handleClick);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      canvas.style.cursor = previousCursor;
      map.off("click", handleClick);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [map, isLoaded, armedAssetId]);

  // Clicking the map (not a marker) deselects
  useEffect(() => {
    if (!map || !isLoaded || armedAssetId || !selectedId) return;
    const handleClick = () => setSelectedId(null);
    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [map, isLoaded, armedAssetId, selectedId]);

  const updatePlaced = useCallback(
    (id: string, patch: Partial<PlacedAsset>) => {
      setPlaced((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...patch } : p))
      );
    },
    []
  );

  const deletePlaced = useCallback((id: string) => {
    setPlaced((prev) => prev.filter((p) => p.id !== id));
    setSelectedId((current) => (current === id ? null : current));
  }, []);

  const deleteAsset = useCallback((assetId: string) => {
    setAssets((prev) => prev.filter((a) => a.id !== assetId));
    setPlaced((prev) => prev.filter((p) => p.assetId !== assetId));
    setArmedAssetId((current) => (current === assetId ? null : current));
  }, []);

  const assetById = useMemo(
    () => new globalThis.Map(assets.map((a) => [a.id, a])),
    [assets]
  );

  // Register placed assets as timeline items
  const registerItems = timeline?.registerItems;
  const timelineItems = useMemo(
    () =>
      placed.map((p) => {
        const asset = assetById.get(p.assetId);
        return {
          id: p.id,
          label: asset?.name ?? "Asset",
          kind: "asset",
          thumbnail: asset?.dataUrl,
          step: p.step,
          setStep: (step: number | null) => updatePlaced(p.id, { step }),
          remove: () => deletePlaced(p.id),
        };
      }),
    [placed, assetById, updatePlaced, deletePlaced]
  );

  useEffect(() => {
    if (!registerItems) return;
    registerItems("assets", timelineItems);
  }, [registerItems, timelineItems]);

  // Unregister only on real unmount — a cleanup on the effect above would briefly
  // register an empty list on every change and clamp the current timeline step
  useEffect(() => {
    if (!registerItems) return;
    return () => registerItems("assets", []);
  }, [registerItems]);

  // Deck export/import: replace-all semantics
  const persistStateRef = useRef({ assets, placed });
  useEffect(() => {
    persistStateRef.current = { assets, placed };
  }, [assets, placed]);

  const registerPersistence = timeline?.registerPersistence;
  useEffect(() => {
    if (!registerPersistence) return;
    registerPersistence("assets", {
      exportData: () => persistStateRef.current,
      importData: (data) => {
        const deck = data as
          | { assets?: SvgAsset[]; placed?: PlacedAsset[] }
          | undefined;
        setAssets(Array.isArray(deck?.assets) ? deck.assets : []);
        setPlaced(Array.isArray(deck?.placed) ? deck.placed : []);
        setSelectedId(null);
        setArmedAssetId(null);
      },
    });
    return () => registerPersistence("assets", null);
  }, [registerPersistence]);

  const timelineStep = timeline?.step ?? null;
  const visiblePlaced = useMemo(
    () =>
      placed.filter(
        (p) =>
          p.step === null || timelineStep === null || p.step <= timelineStep
      ),
    [placed, timelineStep]
  );

  // An instance hidden by the timeline drops out of selection until it's visible again
  const selected = selectedId
    ? visiblePlaced.find((p) => p.id === selectedId) ?? null
    : null;
  const armedAsset = armedAssetId ? assetById.get(armedAssetId) ?? null : null;

  const assignStep = (next: number | null) => {
    if (!selected) return;
    updatePlaced(selected.id, { step: next });
    // Advance the timeline so the asset never vanishes the moment it's assigned
    if (timeline && next !== null && next > timeline.step) {
      timeline.setStep(next);
    }
  };

  const resize = (direction: 1 | -1) => {
    if (!selected) return;
    const next = Math.round(
      direction === 1 ? selected.width * 1.25 : selected.width / 1.25
    );
    updatePlaced(selected.id, {
      width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, next)),
    });
  };

  return (
    <>
      {visiblePlaced.map((p) => {
        const asset = assetById.get(p.assetId);
        if (!asset) return null;
        return (
          <MapMarker
            key={p.id}
            longitude={p.longitude}
            latitude={p.latitude}
            draggable
            onClick={() => setSelectedId(p.id)}
            onDragEnd={({ lng, lat }) =>
              updatePlaced(p.id, { longitude: lng, latitude: lat })
            }
          >
            <MarkerContent>
              <img
                src={asset.dataUrl}
                alt={asset.name}
                draggable={false}
                style={{ width: p.width }}
                className={cn(
                  "max-w-none select-none",
                  selectedId === p.id &&
                    "outline-2 outline-dashed outline-ring outline-offset-2 rounded-sm"
                )}
              />
            </MarkerContent>
          </MapMarker>
        );
      })}

      <div
        className={cn(
          "absolute z-10 flex flex-col gap-1.5",
          positionClasses[position],
          className
        )}
      >
        <div className="flex flex-col rounded-md border border-border bg-background shadow-sm overflow-hidden">
          <PopoverPrimitive.Root open={libraryOpen} onOpenChange={setLibraryOpen}>
            <PopoverPrimitive.Trigger asChild>
              <button
                aria-label="Image assets"
                type="button"
                className={cn(
                  "flex items-center justify-center size-8 transition-colors",
                  libraryOpen
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent dark:hover:bg-accent/40"
                )}
              >
                <ImagePlus className="size-4" />
              </button>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
              <PopoverPrimitive.Content
                side={position.endsWith("right") ? "left" : "right"}
                align="start"
                sideOffset={8}
                className="z-50 w-56 rounded-md border border-border bg-background p-2 shadow-md"
              >
                <div className="flex items-center justify-between px-1 pb-1.5">
                  <span className="text-xs font-medium text-muted-foreground select-none">
                    SVG assets
                  </span>
                  <PanelButton
                    onClick={() => fileInputRef.current?.click()}
                    label="Upload SVG"
                  >
                    <Upload className="size-3.5" />
                  </PanelButton>
                </div>
                {assets.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    Upload an SVG, then click the map to place it.
                  </p>
                ) : (
                  <div className="flex flex-col gap-0.5">
                    {assets.map((asset) => (
                      <div
                        key={asset.id}
                        className="flex items-center gap-1 rounded-sm px-1 py-1 hover:bg-accent dark:hover:bg-accent/40"
                      >
                        <button
                          onClick={() => {
                            setArmedAssetId(asset.id);
                            setSelectedId(null);
                            setLibraryOpen(false);
                          }}
                          type="button"
                          className="flex flex-1 items-center gap-2 min-w-0"
                        >
                          <img
                            src={asset.dataUrl}
                            alt=""
                            draggable={false}
                            className="size-6 shrink-0 object-contain"
                          />
                          <span className="truncate text-xs">{asset.name}</span>
                        </button>
                        <PanelButton
                          onClick={() => deleteAsset(asset.id)}
                          label={`Delete ${asset.name}`}
                        >
                          <Trash2 className="size-3.5" />
                        </PanelButton>
                      </div>
                    ))}
                  </div>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".svg,image/svg+xml"
                  multiple
                  className="hidden"
                  aria-label="Upload SVG files"
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
              </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
          </PopoverPrimitive.Root>
        </div>

        {selected && (
          <div className="flex w-40 flex-col gap-1.5 rounded-md border border-border bg-background p-1.5 shadow-sm">
            <div className="flex items-center justify-between gap-1">
              <span className="truncate px-1 text-xs font-medium select-none">
                {assetById.get(selected.assetId)?.name ?? "Asset"}
              </span>
              <PanelButton onClick={() => setSelectedId(null)} label="Deselect">
                <X className="size-3.5" />
              </PanelButton>
            </div>

            <div className="flex items-center justify-between gap-1">
              <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground select-none">
                Size
              </span>
              <div className="flex items-center gap-0.5">
                <PanelButton
                  onClick={() => resize(-1)}
                  label="Shrink"
                  disabled={selected.width <= MIN_WIDTH}
                >
                  <Minus className="size-3" />
                </PanelButton>
                <span className="w-9 text-center text-xs tabular-nums select-none">
                  {selected.width}px
                </span>
                <PanelButton
                  onClick={() => resize(1)}
                  label="Grow"
                  disabled={selected.width >= MAX_WIDTH}
                >
                  <Plus className="size-3" />
                </PanelButton>
              </div>
            </div>

            {timeline && (
              <div className="flex items-center justify-between gap-1">
                <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground select-none">
                  Step
                </span>
                <div className="flex items-center gap-0.5">
                  <PanelButton
                    onClick={() => {
                      if (selected.step !== null && selected.step > 1) {
                        assignStep(selected.step - 1);
                      }
                    }}
                    label="Decrease step"
                    disabled={selected.step === null || selected.step <= 1}
                  >
                    <Minus className="size-3" />
                  </PanelButton>
                  <span className="w-9 text-center text-xs tabular-nums select-none">
                    {selected.step ?? "—"}
                  </span>
                  <PanelButton
                    onClick={() =>
                      assignStep(
                        selected.step === null
                          ? Math.max(1, timeline.step + 1)
                          : selected.step + 1
                      )
                    }
                    label="Increase step"
                  >
                    <Plus className="size-3" />
                  </PanelButton>
                </div>
              </div>
            )}

            <button
              onClick={() => deletePlaced(selected.id)}
              type="button"
              className="flex items-center justify-center gap-1.5 rounded-sm px-1 py-1 text-xs text-destructive hover:bg-accent dark:hover:bg-accent/40 transition-colors"
            >
              <Trash2 className="size-3.5" />
              Remove from map
            </button>
          </div>
        )}
      </div>

      {armedAsset && (
        <div className="absolute top-2 left-1/2 z-10 -translate-x-1/2 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground shadow-sm select-none">
          Click the map to place “{armedAsset.name}” — Esc to cancel
        </div>
      )}
    </>
  );
}

export { MapAssetControl };
export type { SvgAsset, PlacedAsset };
