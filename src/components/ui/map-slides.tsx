"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Images, Plus, Trash2 } from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { useTimelineOptional } from "@/components/ui/map-timeline";

// ============================================================================
// IndexedDB persistence for slides
// ============================================================================

const DB_NAME = "map-slides";
const DB_VERSION = 1;
const SLIDES_STORE = "slides";

type Slide = {
  id: string;
  url: string;
  name: string;
  /** Timeline step this slide shows on (exact match), or null to always show */
  step: number | null;
};

function openSlidesDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(SLIDES_STORE)) {
        db.createObjectStore(SLIDES_STORE, { keyPath: "id" });
      }
    };
  });
}

async function loadSlidesFromDB(): Promise<Slide[]> {
  try {
    const db = await openSlidesDB();
    const tx = db.transaction(SLIDES_STORE, "readonly");
    const request = tx.objectStore(SLIDES_STORE).getAll();

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        resolve(request.result as Slide[]);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (error) {
    console.error("Failed to load slides from IndexedDB:", error);
    return [];
  }
}

async function saveSlidesToDB(slides: Slide[]): Promise<void> {
  try {
    const db = await openSlidesDB();
    const tx = db.transaction(SLIDES_STORE, "readwrite");
    const store = tx.objectStore(SLIDES_STORE);

    store.clear();
    slides.forEach((slide) => store.put(slide));

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
    console.error("Failed to save slides to IndexedDB:", error);
  }
}

// ============================================================================
// Slide control + overlay
// ============================================================================

const positionClasses = {
  "top-left": "top-2 left-2",
  "top-right": "top-2 right-2",
  "bottom-left": "bottom-2 left-2",
  "bottom-right": "bottom-10 right-2",
};

function slideNameFromUrl(url: string): string {
  try {
    const pathname = new URL(url, window.location.href).pathname;
    const segment = pathname.split("/").filter(Boolean).pop();
    return segment ? decodeURIComponent(segment) : "Slide";
  } catch {
    return "Slide";
  }
}

type MapSlideControlProps = {
  /** Position of the slide manager button on the map (default: "top-right") */
  position?: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  /** Additional CSS classes for the controls container */
  className?: string;
};

function MapSlideControl({
  position = "top-right",
  className,
}: MapSlideControlProps) {
  const timeline = useTimelineOptional();

  const [slides, setSlides] = useState<Slide[]>([]);
  const [managerOpen, setManagerOpen] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [brokenIds, setBrokenIds] = useState<Set<string>>(new Set());
  const hasLoadedRef = useRef(false);

  // Load persisted slides on mount
  useEffect(() => {
    loadSlidesFromDB().then((stored) => {
      setSlides(stored);
      hasLoadedRef.current = true;
    });
  }, []);

  // Persist on change
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    saveSlidesToDB(slides);
  }, [slides]);

  const timelineStep = timeline?.step ?? null;

  const addSlide = useCallback(() => {
    const url = urlInput.trim();
    if (!url) return;
    setSlides((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        url,
        name: slideNameFromUrl(url),
        // Default to the step currently on screen so the slide shows right away
        step: timelineStep === null ? null : Math.max(1, timelineStep),
      },
    ]);
    setUrlInput("");
  }, [urlInput, timelineStep]);

  const deleteSlide = useCallback((id: string) => {
    setSlides((prev) => prev.filter((s) => s.id !== id));
  }, []);

  // Register slides as timeline items so the overview panel can manage their steps
  const registerItems = timeline?.registerItems;
  const timelineItems = useMemo(
    () =>
      slides.map((slide) => ({
        id: slide.id,
        label: slide.name,
        kind: "slide",
        thumbnail: slide.url,
        step: slide.step,
        setStep: (step: number | null) =>
          setSlides((prev) =>
            prev.map((s) => (s.id === slide.id ? { ...s, step } : s))
          ),
        remove: () => deleteSlide(slide.id),
      })),
    [slides, deleteSlide]
  );

  useEffect(() => {
    if (!registerItems) return;
    registerItems("slides", timelineItems);
  }, [registerItems, timelineItems]);

  // Unregister only on real unmount — a cleanup on the effect above would briefly
  // register an empty list on every change and clamp the current timeline step
  useEffect(() => {
    if (!registerItems) return;
    return () => registerItems("slides", []);
  }, [registerItems]);

  // Deck export/import: replace-all semantics
  const persistStateRef = useRef(slides);
  useEffect(() => {
    persistStateRef.current = slides;
  }, [slides]);

  const registerPersistence = timeline?.registerPersistence;
  useEffect(() => {
    if (!registerPersistence) return;
    registerPersistence("slides", {
      exportData: () => ({ slides: persistStateRef.current }),
      importData: (data) => {
        const deck = data as { slides?: Slide[] } | undefined;
        setSlides(Array.isArray(deck?.slides) ? deck.slides : []);
        setBrokenIds(new Set());
      },
    });
    return () => registerPersistence("slides", null);
  }, [registerPersistence]);

  // Exact-step match wins; a step-less slide acts as an always-on fallback
  const activeSlide = useMemo(() => {
    const exact =
      timelineStep === null
        ? null
        : slides.find((s) => s.step === timelineStep) ?? null;
    return exact ?? slides.find((s) => s.step === null) ?? null;
  }, [slides, timelineStep]);

  const markBroken = useCallback((id: string) => {
    setBrokenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  return (
    <>
      {/* Every slide stays mounted so images are fetched and decoded ahead of their
          step; reaching a step only flips CSS visibility — no load delay */}
      <div
        className={cn(
          "absolute inset-y-0 right-0 z-[5] w-2/5 border-l border-border bg-background/85 backdrop-blur-sm",
          !activeSlide && "hidden"
        )}
      >
        {activeSlide && brokenIds.has(activeSlide.id) && (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
            Couldn't load {activeSlide.url}
          </div>
        )}
        {slides.map(
          (slide) =>
            !brokenIds.has(slide.id) && (
              <img
                key={slide.id}
                src={slide.url}
                alt={slide.name}
                draggable={false}
                decoding="async"
                onError={() => markBroken(slide.id)}
                className={cn(
                  "h-full w-full object-contain p-4",
                  slide.id !== activeSlide?.id && "hidden"
                )}
              />
            )
        )}
      </div>

      <div
        className={cn(
          "absolute z-10 flex flex-col gap-1.5",
          positionClasses[position],
          className
        )}
      >
        <div className="flex flex-col rounded-md border border-border bg-background shadow-sm overflow-hidden">
          <PopoverPrimitive.Root open={managerOpen} onOpenChange={setManagerOpen}>
            <PopoverPrimitive.Trigger asChild>
              <button
                aria-label="Image slides"
                type="button"
                className={cn(
                  "flex items-center justify-center size-8 transition-colors",
                  managerOpen
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent dark:hover:bg-accent/40"
                )}
              >
                <Images className="size-4" />
              </button>
            </PopoverPrimitive.Trigger>
            <PopoverPrimitive.Portal>
              <PopoverPrimitive.Content
                side={position.endsWith("right") ? "left" : "right"}
                align="start"
                sideOffset={8}
                className="z-50 w-72 rounded-md border border-border bg-background p-2 shadow-md"
              >
                <div className="px-1 pb-1.5 text-xs font-medium text-muted-foreground select-none">
                  Image slides
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    addSlide();
                  }}
                  className="flex items-center gap-1"
                >
                  <input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    placeholder="Paste image URL…"
                    aria-label="Image URL"
                    className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-transparent px-2 text-xs outline-none focus:border-ring"
                  />
                  <button
                    type="submit"
                    aria-label="Add slide"
                    disabled={urlInput.trim().length === 0}
                    className={cn(
                      "flex items-center justify-center size-7 shrink-0 rounded-sm border border-border hover:bg-accent dark:hover:bg-accent/40 transition-colors",
                      urlInput.trim().length === 0 &&
                        "opacity-50 pointer-events-none cursor-not-allowed"
                    )}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </form>
                {slides.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    Add an image URL — it shows on the step it's assigned to.
                    Adjust steps in the timeline overview.
                  </p>
                ) : (
                  <div className="mt-1.5 flex max-h-64 flex-col gap-0.5 overflow-y-auto">
                    {slides.map((slide) => (
                      <div
                        key={slide.id}
                        className="flex items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent dark:hover:bg-accent/40"
                      >
                        <img
                          src={slide.url}
                          alt=""
                          draggable={false}
                          className="size-8 shrink-0 rounded-sm object-cover"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs">{slide.name}</div>
                          <div className="text-[10px] text-muted-foreground select-none">
                            {slide.step === null
                              ? "Always"
                              : `Step ${slide.step}`}
                          </div>
                        </div>
                        <button
                          onClick={() => deleteSlide(slide.id)}
                          aria-label={`Delete slide ${slide.name}`}
                          type="button"
                          className="flex items-center justify-center size-6 shrink-0 rounded-sm hover:bg-accent dark:hover:bg-accent/40 transition-colors"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </PopoverPrimitive.Content>
            </PopoverPrimitive.Portal>
          </PopoverPrimitive.Root>
        </div>
      </div>
    </>
  );
}

export { MapSlideControl };
export type { Slide };
