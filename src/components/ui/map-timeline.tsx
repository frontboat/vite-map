"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Image as ImageIcon,
  List,
  ListPlus,
  MapPin,
  Minus,
  Pencil,
  PenLine,
  Pentagon,
  Plus,
  Square,
  Trash2,
  Upload,
  Waypoints,
  X,
} from "lucide-react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

type TimelineItem = {
  id: string;
  /** Display name in the overview panel */
  label: string;
  /** Item kind, used to pick an icon: "asset" or a draw mode like "point" */
  kind: string;
  /** Optional image preview (used for SVG assets) */
  thumbnail?: string;
  /** Assigned step, or null when always visible */
  step: number | null;
  /** Assign or clear this item's step */
  setStep: (step: number | null) => void;
  /** Remove this single item from the map (instance only, not its source asset) */
  remove?: () => void;
};

/**
 * A cosmetic container of steps. A section spans from its start step until the
 * next section's start (or the end of the deck). It never affects visibility.
 */
type TimelineSection = {
  id: string;
  name: string;
  start: number;
};

/** Everything a source needs to take part in deck export/import */
type PersistenceHandler = {
  exportData: () => unknown;
  importData: (data: unknown) => void;
};

/** Serialized presentation: sections, deck length, and each source's payload */
type DeckFile = {
  version: 1;
  sections: TimelineSection[];
  stepCount: number;
  sources: Record<string, unknown>;
};

type TimelineContextValue = {
  /** Current step. 0 is the start state — only unassigned items are visible. */
  step: number;
  /** Deck length: highest of assigned item steps, section starts, and planned steps. */
  maxStep: number;
  setStep: (step: number) => void;
  next: () => void;
  prev: () => void;
  /** Every item registered by all sources, for the overview panel */
  items: TimelineItem[];
  /** Sources (draw features, assets, ...) register their current items */
  registerItems: (sourceId: string, items: TimelineItem[]) => void;
  /** Sections, sorted by start step */
  sections: TimelineSection[];
  /** Append a new section (with one empty step) at the end of the deck */
  addSection: (id: string, name: string) => void;
  renameSection: (id: string, name: string) => void;
  /** Remove the section container only — its steps and items stay */
  removeSection: (id: string) => void;
  /** Append a new empty step at the end of the given section */
  addStepToSection: (id: string) => void;
  /** Remove step `at`: its items merge into the previous step, later steps shift down */
  removeStep: (at: number) => void;
  /** Sources register export/import handlers for deck files (null to unregister) */
  registerPersistence: (
    sourceId: string,
    handler: PersistenceHandler | null
  ) => void;
  /** Snapshot the whole presentation as a serializable deck file */
  exportDeck: () => DeckFile;
  /** Replace the whole presentation from a deck file and rewind to step 0 */
  importDeck: (data: DeckFile) => void;
};

const TimelineContext = createContext<TimelineContextValue | null>(null);

function useTimeline() {
  const context = useContext(TimelineContext);
  if (!context) {
    throw new Error("Timeline components must be used within MapTimeline");
  }
  return context;
}

/** Like useTimeline, but returns null outside a MapTimeline so integrations stay optional. */
function useTimelineOptional() {
  return useContext(TimelineContext);
}

type TimelineState = {
  step: number;
  sources: Record<string, TimelineItem[]>;
  sections: TimelineSection[];
  /** Planned deck length — keeps empty steps alive when items are removed */
  stepCount: number;
};

type TimelineAction =
  | { type: "register"; sourceId: string; items: TimelineItem[] }
  | { type: "set"; step: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "hydrate"; sections: TimelineSection[]; stepCount: number }
  | { type: "addSection"; id: string; name: string }
  | { type: "renameSection"; id: string; name: string }
  | { type: "removeSection"; id: string }
  | { type: "insertAt"; at: number }
  | { type: "removeAt"; at: number };

function maxStepOf(state: TimelineState): number {
  let max = state.stepCount;
  for (const items of Object.values(state.sources)) {
    for (const item of items) {
      if (item.step !== null && item.step > max) max = item.step;
    }
  }
  for (const section of state.sections) {
    if (section.start > max) max = section.start;
  }
  return max;
}

function sortedSections(sections: TimelineSection[]): TimelineSection[] {
  return [...sections].sort((a, b) => a.start - b.start);
}

function timelineReducer(
  state: TimelineState,
  action: TimelineAction
): TimelineState {
  switch (action.type) {
    case "register": {
      if (state.sources[action.sourceId] === action.items) return state;
      const next = {
        ...state,
        sources: { ...state.sources, [action.sourceId]: action.items },
      };
      // Clamp when items shrink the timeline; never advance on the timeline's own
      return { ...next, step: Math.min(state.step, maxStepOf(next)) };
    }
    // "set" isn't clamped to maxStep: step assignment auto-advances before the
    // assigning source has re-registered its items, so the new max isn't known yet
    case "set":
      return { ...state, step: Math.max(0, action.step) };
    case "next":
      return { ...state, step: Math.min(state.step + 1, maxStepOf(state)) };
    case "prev":
      return { ...state, step: Math.max(state.step - 1, 0) };
    case "hydrate":
      return { ...state, sections: action.sections, stepCount: action.stepCount };
    case "addSection": {
      const start = maxStepOf(state) + 1;
      return {
        ...state,
        sections: [
          ...state.sections,
          { id: action.id, name: action.name, start },
        ],
        stepCount: start,
      };
    }
    case "renameSection":
      return {
        ...state,
        sections: state.sections.map((s) =>
          s.id === action.id ? { ...s, name: action.name } : s
        ),
      };
    case "removeSection":
      return {
        ...state,
        sections: state.sections.filter((s) => s.id !== action.id),
      };
    case "insertAt": {
      // Item steps are shifted by the caller before this dispatches, so sources
      // here still reflect the pre-insert layout — maxStepOf(state) is the old max
      return {
        ...state,
        stepCount: maxStepOf(state) + 1,
        sections: state.sections.map((s) =>
          s.start >= action.at ? { ...s, start: s.start + 1 } : s
        ),
        step: state.step >= action.at ? state.step + 1 : state.step,
      };
    }
    case "removeAt": {
      const sections: TimelineSection[] = [];
      for (const s of state.sections) {
        // A section whose only step was `at` dies with it (the next section
        // starts right behind it, so after the shift they would collide)
        if (
          s.start === action.at &&
          state.sections.some((o) => o.start === action.at + 1)
        ) {
          continue;
        }
        sections.push(
          s.start > action.at ? { ...s, start: s.start - 1 } : s
        );
      }
      return {
        ...state,
        sections,
        stepCount: Math.max(0, maxStepOf(state) - 1),
        step:
          state.step >= action.at ? Math.max(0, state.step - 1) : state.step,
      };
    }
  }
}

// ============================================================================
// IndexedDB persistence for sections
// ============================================================================

const DB_NAME = "map-timeline";
const DB_VERSION = 1;
const KV_STORE = "kv";

type PersistedSections = { sections: TimelineSection[]; stepCount: number };

function openTimelineDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(KV_STORE)) {
        db.createObjectStore(KV_STORE, { keyPath: "id" });
      }
    };
  });
}

async function loadSectionsFromDB(): Promise<PersistedSections> {
  try {
    const db = await openTimelineDB();
    const tx = db.transaction(KV_STORE, "readonly");
    const store = tx.objectStore(KV_STORE);
    const sectionsRequest = store.get("sections");
    const legacyLabelsRequest = store.get("labels");

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => {
        db.close();
        const stored = (
          sectionsRequest.result as { data: PersistedSections } | undefined
        )?.data;
        if (stored) {
          resolve(stored);
          return;
        }
        // Migrate from the old per-step label format
        const legacy = (
          legacyLabelsRequest.result as
            | { data: Record<number, string> }
            | undefined
        )?.data;
        if (legacy && Object.keys(legacy).length > 0) {
          const sections = Object.entries(legacy).map(([step, name]) => ({
            id: crypto.randomUUID(),
            name,
            start: Number(step),
          }));
          resolve({
            sections,
            stepCount: Math.max(...sections.map((s) => s.start)),
          });
          return;
        }
        resolve({ sections: [], stepCount: 0 });
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  } catch (error) {
    console.error("Failed to load timeline sections from IndexedDB:", error);
    return { sections: [], stepCount: 0 };
  }
}

async function saveSectionsToDB(data: PersistedSections): Promise<void> {
  try {
    const db = await openTimelineDB();
    const tx = db.transaction(KV_STORE, "readwrite");
    tx.objectStore(KV_STORE).put({ id: "sections", data });

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
    console.error("Failed to save timeline sections to IndexedDB:", error);
  }
}

function MapTimeline({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(timelineReducer, {
    step: 0,
    sources: {},
    sections: [],
    stepCount: 0,
  });
  const hasLoadedRef = useRef(false);

  // Load persisted sections on mount (migrating old per-step labels if present)
  useEffect(() => {
    loadSectionsFromDB().then(({ sections, stepCount }) => {
      dispatch({ type: "hydrate", sections, stepCount });
      hasLoadedRef.current = true;
    });
  }, []);

  // Persist on change
  useEffect(() => {
    if (!hasLoadedRef.current) return;
    saveSectionsToDB({ sections: state.sections, stepCount: state.stepCount });
  }, [state.sections, state.stepCount]);

  const items = useMemo(
    () => Object.values(state.sources).flat(),
    [state.sources]
  );
  const maxStep = useMemo(() => maxStepOf(state), [state]);
  const sections = useMemo(
    () => sortedSections(state.sections),
    [state.sections]
  );
  const step = state.step;

  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const setStep = useCallback(
    (next: number) => dispatch({ type: "set", step: next }),
    []
  );
  const next = useCallback(() => dispatch({ type: "next" }), []);
  const prev = useCallback(() => dispatch({ type: "prev" }), []);
  const registerItems = useCallback(
    (sourceId: string, sourceItems: TimelineItem[]) =>
      dispatch({ type: "register", sourceId, items: sourceItems }),
    []
  );
  const addSection = useCallback(
    (id: string, name: string) => dispatch({ type: "addSection", id, name }),
    []
  );
  const renameSection = useCallback(
    (id: string, name: string) =>
      dispatch({ type: "renameSection", id, name }),
    []
  );
  const removeSection = useCallback(
    (id: string) => dispatch({ type: "removeSection", id }),
    []
  );

  const addStepToSection = useCallback(
    (id: string) => {
      const index = sections.findIndex((s) => s.id === id);
      if (index === -1) return;
      const nextSection = sections[index + 1];
      // New step goes at the end of this section: right before the next
      // section, or at the end of the deck for the last section
      const at = nextSection ? nextSection.start : maxStep + 1;
      for (const item of itemsRef.current) {
        if (item.step !== null && item.step >= at) {
          item.setStep(item.step + 1);
        }
      }
      dispatch({ type: "insertAt", at });
    },
    [sections, maxStep]
  );

  const removeStep = useCallback((at: number) => {
    for (const item of itemsRef.current) {
      if (item.step === null) continue;
      if (item.step === at) {
        // Merge into the previous step — never dump items to always-visible
        item.setStep(Math.max(1, at - 1));
      } else if (item.step > at) {
        item.setStep(item.step - 1);
      }
    }
    dispatch({ type: "removeAt", at });
  }, []);

  // Deck export/import — handlers live in a ref, they don't affect rendering
  const persistenceRef = useRef(
    new globalThis.Map<string, PersistenceHandler>()
  );
  const registerPersistence = useCallback(
    (sourceId: string, handler: PersistenceHandler | null) => {
      if (handler) {
        persistenceRef.current.set(sourceId, handler);
      } else {
        persistenceRef.current.delete(sourceId);
      }
    },
    []
  );

  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const exportDeck = useCallback((): DeckFile => {
    const sources: Record<string, unknown> = {};
    for (const [sourceId, handler] of persistenceRef.current) {
      sources[sourceId] = handler.exportData();
    }
    return {
      version: 1,
      sections: sortedSections(stateRef.current.sections),
      stepCount: stateRef.current.stepCount,
      sources,
    };
  }, []);

  const importDeck = useCallback((data: DeckFile) => {
    for (const [sourceId, handler] of persistenceRef.current) {
      handler.importData(data.sources?.[sourceId]);
    }
    dispatch({
      type: "hydrate",
      sections: Array.isArray(data.sections) ? data.sections : [],
      stepCount: typeof data.stepCount === "number" ? data.stepCount : 0,
    });
    dispatch({ type: "set", step: 0 });
  }, []);

  const value = useMemo(
    () => ({
      step,
      maxStep,
      setStep,
      next,
      prev,
      items,
      registerItems,
      sections,
      addSection,
      renameSection,
      removeSection,
      addStepToSection,
      removeStep,
      registerPersistence,
      exportDeck,
      importDeck,
    }),
    [step, maxStep, setStep, next, prev, items, registerItems, sections, addSection, renameSection, removeSection, addStepToSection, removeStep, registerPersistence, exportDeck, importDeck]
  );

  return (
    <TimelineContext.Provider value={value}>
      {children}
    </TimelineContext.Provider>
  );
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

// ============================================================================
// Overview panel
// ============================================================================

const kindIcons: Record<string, typeof MapPin> = {
  asset: ImageIcon,
  point: MapPin,
  linestring: Waypoints,
  polygon: Pentagon,
  rectangle: Square,
  circle: Circle,
  freehand: PenLine,
};

function ItemIcon({ item }: { item: TimelineItem }) {
  if (item.thumbnail) {
    return (
      <img
        src={item.thumbnail}
        alt=""
        draggable={false}
        className="size-5 shrink-0 object-contain"
      />
    );
  }
  const Icon = kindIcons[item.kind] ?? MapPin;
  return <Icon className="size-3.5 shrink-0 text-muted-foreground" />;
}

function ItemRowButton({
  onClick,
  label,
  disabled = false,
  children,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
  children: ReactNode;
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

function ItemRow({ item, currentStep }: { item: TimelineItem; currentStep: number }) {
  const hidden = item.step !== null && item.step > currentStep;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-sm px-1 py-1",
        hidden && "opacity-50"
      )}
    >
      <ItemIcon item={item} />
      <span className="flex-1 truncate text-xs select-none">{item.label}</span>
      <ItemRowButton
        onClick={() => {
          if (item.step !== null && item.step > 1) item.setStep(item.step - 1);
        }}
        label={`Decrease step — ${item.label}`}
        disabled={item.step === null || item.step <= 1}
      >
        <Minus className="size-3" />
      </ItemRowButton>
      <span className="w-5 text-center text-xs tabular-nums select-none">
        {item.step ?? "—"}
      </span>
      <ItemRowButton
        onClick={() => item.setStep(item.step === null ? 1 : item.step + 1)}
        label={`Increase step — ${item.label}`}
      >
        <Plus className="size-3" />
      </ItemRowButton>
      <ItemRowButton
        onClick={() => item.setStep(null)}
        label={`Clear step — ${item.label}`}
        disabled={item.step === null}
      >
        <X className="size-3" />
      </ItemRowButton>
      {item.remove && (
        <ItemRowButton
          onClick={item.remove}
          label={`Remove ${item.label} from map`}
        >
          <Trash2 className="size-3" />
        </ItemRowButton>
      )}
    </div>
  );
}

function StepBlock({
  step,
  currentStep,
  items,
  indented,
  onJump,
  onRemove,
}: {
  step: number;
  currentStep: number;
  items: TimelineItem[];
  indented: boolean;
  onJump: () => void;
  onRemove: () => void;
}) {
  return (
    <div className={cn(indented && "pl-2")}>
      <div className="flex items-center gap-0.5">
        <button
          onClick={onJump}
          aria-label={`Go to step ${step}`}
          type="button"
          className={cn(
            "flex min-w-0 flex-1 items-baseline gap-1.5 rounded-sm px-1 py-0.5 text-left text-[10px] font-medium uppercase tracking-wide hover:bg-accent dark:hover:bg-accent/40 transition-colors select-none",
            step === currentStep ? "text-foreground" : "text-muted-foreground"
          )}
        >
          <span className="shrink-0">Step {step}</span>
          {step === currentStep && <span className="shrink-0">— current</span>}
        </button>
        <ItemRowButton onClick={onRemove} label={`Remove step ${step}`}>
          <Trash2 className="size-3" />
        </ItemRowButton>
      </div>
      {items.length === 0 ? (
        <p className="px-1 py-0.5 text-[10px] italic text-muted-foreground select-none">
          No items yet
        </p>
      ) : (
        items.map((item) => (
          <ItemRow key={item.id} item={item} currentStep={currentStep} />
        ))
      )}
    </div>
  );
}

function MapTimelinePanel() {
  const {
    step,
    maxStep,
    setStep,
    items,
    sections,
    addSection,
    renameSection,
    removeSection,
    addStepToSection,
    removeStep,
    exportDeck,
    importDeck,
  } = useTimeline();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(exportDeck(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "presentation-deck.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importDeck(JSON.parse(reader.result as string));
      } catch (error) {
        console.error("Failed to parse deck file:", error);
      }
    };
    reader.readAsText(file);
  };

  const groups = useMemo(() => {
    const always = items.filter((item) => item.step === null);
    const bySteps = new globalThis.Map<number, TimelineItem[]>();
    for (const item of items) {
      if (item.step === null) continue;
      const group = bySteps.get(item.step);
      if (group) {
        group.push(item);
      } else {
        bySteps.set(item.step, [item]);
      }
    }
    return { always, bySteps };
  }, [items]);

  const sectionAtStep = useMemo(() => {
    const map = new globalThis.Map<number, TimelineSection>();
    for (const section of sections) map.set(section.start, section);
    return map;
  }, [sections]);

  const commitEditing = () => {
    if (editingId === null) return;
    const name = draft.trim();
    if (name) {
      renameSection(editingId, name);
    } else {
      // Clearing the name removes the container (steps stay)
      removeSection(editingId);
    }
    setEditingId(null);
  };

  const handleAddSection = () => {
    const id = crypto.randomUUID();
    addSection(id, "New section");
    setEditingId(id);
    setDraft("New section");
  };

  const firstSectionStart = sections[0]?.start ?? Infinity;

  return (
    <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
      {items.length === 0 && maxStep === 0 && (
        <p className="px-1 py-2 text-xs text-muted-foreground">
          Nothing on the map yet. Place an asset or draw a shape first.
        </p>
      )}
      {groups.always.length > 0 && (
        <div>
          <div className="px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground select-none">
            Always visible
          </div>
          {groups.always.map((item) => (
            <ItemRow key={item.id} item={item} currentStep={step} />
          ))}
        </div>
      )}
      {Array.from({ length: maxStep }, (_, i) => i + 1).map((n) => {
        const section = sectionAtStep.get(n);
        return (
          <div key={n}>
            {section && (
              <div className="flex items-center gap-0.5 border-t border-border pt-1 mt-0.5">
                {editingId === section.id ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitEditing}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitEditing();
                      if (e.key === "Escape") {
                        // Cancel the edit only — don't let radix close the popover
                        e.stopPropagation();
                        setEditingId(null);
                      }
                    }}
                    placeholder="Section name…"
                    aria-label="Section name"
                    className="h-6 min-w-0 flex-1 rounded-sm border border-border bg-transparent px-1 text-xs outline-none focus:border-ring"
                  />
                ) : (
                  <button
                    onClick={() => setStep(section.start)}
                    aria-label={`Go to section ${section.name}`}
                    type="button"
                    className="min-w-0 flex-1 truncate rounded-sm px-1 py-0.5 text-left text-xs font-semibold hover:bg-accent dark:hover:bg-accent/40 transition-colors select-none"
                  >
                    {section.name}
                  </button>
                )}
                <ItemRowButton
                  onClick={() => {
                    setEditingId(section.id);
                    setDraft(section.name);
                  }}
                  label={`Rename section ${section.name}`}
                >
                  <Pencil className="size-3" />
                </ItemRowButton>
                <ItemRowButton
                  onClick={() => addStepToSection(section.id)}
                  label={`Add step to ${section.name}`}
                >
                  <ListPlus className="size-3" />
                </ItemRowButton>
                <ItemRowButton
                  onClick={() => removeSection(section.id)}
                  label={`Remove section ${section.name}`}
                >
                  <Trash2 className="size-3" />
                </ItemRowButton>
              </div>
            )}
            <StepBlock
              step={n}
              currentStep={step}
              items={groups.bySteps.get(n) ?? []}
              indented={n >= firstSectionStart}
              onJump={() => setStep(n)}
              onRemove={() => removeStep(n)}
            />
          </div>
        );
      })}
      <div className="flex items-center gap-0.5 border-t border-border pt-1 mt-0.5">
        <button
          onClick={handleAddSection}
          type="button"
          className="flex flex-1 items-center gap-1.5 rounded-sm px-1 py-1 text-xs text-muted-foreground hover:bg-accent dark:hover:bg-accent/40 hover:text-foreground transition-colors select-none"
        >
          <Plus className="size-3" />
          Add section
        </button>
        <ItemRowButton onClick={handleExport} label="Export deck">
          <Download className="size-3" />
        </ItemRowButton>
        <ItemRowButton
          onClick={() => importInputRef.current?.click()}
          label="Import deck"
        >
          <Upload className="size-3" />
        </ItemRowButton>
        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Import deck file"
          onChange={(e) => {
            handleImportFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// ============================================================================
// Timeline control bar
// ============================================================================

type MapTimelineControlProps = {
  /** Additional CSS classes for the control container */
  className?: string;
  /** Navigate steps with ArrowLeft/ArrowRight (default: true) */
  keyboard?: boolean;
};

function MapTimelineControl({
  className,
  keyboard = true,
}: MapTimelineControlProps) {
  const { step, maxStep, next, prev, sections } = useTimeline();
  const [panelOpen, setPanelOpen] = useState(false);

  const currentSection = useMemo(() => {
    let match: TimelineSection | null = null;
    for (const section of sections) {
      if (section.start <= step) match = section;
    }
    return match;
  }, [sections, step]);

  useEffect(() => {
    if (!keyboard) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (isTypingTarget(e.target)) return;
      // Capture phase + stopPropagation so the arrows win over MapLibre's keyboard panning
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "ArrowRight") {
        next();
      } else {
        prev();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [keyboard, next, prev]);

  return (
    <div
      className={cn(
        "absolute bottom-2 left-1/2 -translate-x-1/2 z-10",
        className
      )}
    >
      <div className="flex items-center rounded-md border border-border bg-background shadow-sm overflow-hidden">
        <PopoverPrimitive.Root open={panelOpen} onOpenChange={setPanelOpen}>
          <PopoverPrimitive.Trigger asChild>
            <button
              aria-label="Timeline overview"
              type="button"
              className={cn(
                "flex items-center justify-center size-8 transition-colors border-r border-border",
                panelOpen
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent dark:hover:bg-accent/40"
              )}
            >
              <List className="size-4" />
            </button>
          </PopoverPrimitive.Trigger>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              side="top"
              align="start"
              sideOffset={8}
              onEscapeKeyDown={(e) => {
                // While renaming a section, Escape cancels the edit (input's own
                // handler), not the whole popover
                if (isTypingTarget(document.activeElement)) {
                  e.preventDefault();
                }
              }}
              className="z-50 w-72 rounded-md border border-border bg-background p-2 shadow-md"
            >
              <MapTimelinePanel />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
        <button
          onClick={prev}
          aria-label="Previous step"
          type="button"
          disabled={step === 0}
          className={cn(
            "flex items-center justify-center size-8 hover:bg-accent dark:hover:bg-accent/40 transition-colors",
            step === 0 && "opacity-50 pointer-events-none cursor-not-allowed"
          )}
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-12 px-2 text-center text-xs font-medium tabular-nums text-muted-foreground select-none">
          {step} / {maxStep}
        </span>
        {step > 0 && currentSection && (
          <span className="max-w-40 truncate pr-2 text-xs text-muted-foreground select-none">
            {currentSection.name}
          </span>
        )}
        <button
          onClick={next}
          aria-label="Next step"
          type="button"
          disabled={step >= maxStep}
          className={cn(
            "flex items-center justify-center size-8 hover:bg-accent dark:hover:bg-accent/40 transition-colors",
            step >= maxStep &&
              "opacity-50 pointer-events-none cursor-not-allowed"
          )}
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

export { MapTimeline, MapTimelineControl, useTimeline, useTimelineOptional };
export type { TimelineItem, TimelineSection };
