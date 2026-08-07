import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { Check, LogOut, RefreshCw, RotateCcw, Undo2 } from "lucide-react";

import { compactFans } from "../lib/format.ts";
import { Button, ClubChip, ErrorNote, Ribbon, Spinner } from "../components/Bits.tsx";

interface Officer {
  id: number;
  username: string;
  display_name: string;
  role: string;
}

interface RosterEntry {
  friend_viewer_id: number;
  circle_id: number | null;
  position: number;
  source: "projected" | "manual";
  projected_circle_id: number | null;
  name: string;
  mtd_avg: number | null;
}

interface RosterClub {
  circle_id: number;
  name: string;
  slot_order: number;
  capacity: number;
  in_pool: number;
}

interface Notice {
  id: number;
  body: string;
  circle_id: number | null;
  created_at: string;
  done_at: string | null;
  author: string | null;
  done_by_name: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/admin/${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `${res.status}`);
  return body as T;
}

export function Officers() {
  const [officer, setOfficer] = useState<Officer | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    api<{ officer: Officer }>("me")
      .then((r) => setOfficer(r.officer))
      .catch(() => setOfficer(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <Spinner label="Checking session" />;
  if (!officer) return <LoginForm onSignedIn={setOfficer} />;

  return (
    <div className="space-y-8">
      <header className="flex items-center gap-3">
        <h1 className="font-display text-2xl font-extrabold text-ink-900">Officers</h1>
        <span className="capsule bg-lav-300 px-2.5 py-0.5 text-xs font-semibold text-ink-900">
          {officer.display_name}
        </span>
        <button
          onClick={async () => {
            await api("logout", { method: "POST" });
            setOfficer(null);
          }}
          className="capsule ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-ink-600 hover:bg-cream-200"
        >
          <LogOut size={14} /> Sign out
        </button>
      </header>

      <RefreshData />
      <Noticeboard />
      <RosterEditor />
    </div>
  );
}

function LoginForm({ onSignedIn }: { onSignedIn: (officer: Officer) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mx-auto max-w-sm space-y-3"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const r = await api<{ officer: Officer }>("login", {
            method: "POST",
            body: JSON.stringify({ username, password }),
          });
          onSignedIn(r.officer);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h1 className="font-display text-2xl font-extrabold text-ink-900">Officer sign in</h1>
      <p className="text-sm text-ink-500">Members don't need an account — this is for officers.</p>

      <input
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        placeholder="Username"
        autoComplete="username"
        className="card w-full bg-cream-50 px-4 py-2.5 outline-none focus:border-teal-400"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
        autoComplete="current-password"
        className="card w-full bg-cream-50 px-4 py-2.5 outline-none focus:border-teal-400"
      />

      {error && <ErrorNote message={error} />}

      <Button type="submit" disabled={busy} className="w-full py-2.5">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}

/** Force a data pull without waiting for the daily cron. */
function RefreshData() {
  const [state, setState] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="card flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">Refresh the numbers</p>
        <p className="text-xs text-ink-500">
          {state ?? "Runs automatically after 10:15 UTC daily. Pull early after a reshuffle."}
        </p>
      </div>
      <Button
        tone="quiet"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setState("Pulling from chronogenesis…");
          try {
            const r = await api<{ ok: boolean; summaries: { status: string }[] }>("ingest", {
              method: "POST",
            });
            const ok = r.summaries.filter((s) => s.status === "ok").length;
            setState(`Done — ${ok} of ${r.summaries.length} clubs updated. Reload to see it.`);
          } catch (e) {
            setState(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="flex items-center gap-1.5">
          <RefreshCw size={13} /> {busy ? "Working…" : "Refresh now"}
        </span>
      </Button>
    </section>
  );
}

function Noticeboard() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [draft, setDraft] = useState("");
  const [showArchive, setShowArchive] = useState(false);

  const reload = useCallback(() => {
    api<{ notices: Notice[] }>("notices").then((r) => setNotices(r.notices));
  }, []);

  useEffect(reload, [reload]);

  const open = notices.filter((n) => !n.done_at);
  const archived = notices.filter((n) => n.done_at);

  return (
    <section className="space-y-3">
      <Ribbon>Noticeboard</Ribbon>

      <form
        className="flex gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          await api("notices", { method: "POST", body: JSON.stringify({ body: draft }) });
          setDraft("");
          reload();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Leave a note for the other officers"
          className="card flex-1 bg-cream-50 px-4 py-2.5 text-sm outline-none focus:border-teal-400"
        />
        <Button type="submit">Post</Button>
      </form>

      <ul className="space-y-2">
        {open.length === 0 && <li className="text-sm text-ink-400">Nothing outstanding.</li>}
        {open.map((notice) => (
          <li key={notice.id} className="card flex items-start gap-3 px-4 py-3">
            <button
              onClick={async () => {
                await api("notices", {
                  method: "PATCH",
                  body: JSON.stringify({ id: notice.id, done: true }),
                });
                reload();
              }}
              title="Mark done"
              className="capsule mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center border border-cream-300 hover:bg-teal-100"
            >
              <Check size={13} className="text-teal-700" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink-900">{notice.body}</p>
              <p className="mt-0.5 text-[11px] text-ink-400">
                {notice.author} · {new Date(notice.created_at).toLocaleDateString()}
              </p>
            </div>
          </li>
        ))}
      </ul>

      {archived.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchive((v) => !v)}
            className="text-sm font-semibold text-teal-700 hover:underline"
          >
            {showArchive ? "Hide" : "Show"} archive ({archived.length})
          </button>

          {showArchive && (
            <ul className="mt-2 space-y-1">
              {archived.map((notice) => (
                <li
                  key={notice.id}
                  className="card flex items-start gap-3 bg-cream-100 px-4 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink-500 line-through">{notice.body}</p>
                    <p className="text-[11px] text-ink-400">
                      done by {notice.done_by_name} ·{" "}
                      {notice.done_at && new Date(notice.done_at).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      await api("notices", {
                        method: "PATCH",
                        body: JSON.stringify({ id: notice.id, done: false }),
                      });
                      reload();
                    }}
                    title="Reopen"
                    className="capsule px-2 py-1 text-ink-400 hover:bg-cream-200"
                  >
                    <Undo2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Drag-and-drop roster editor (D022).
 *
 * The projection seeds the plan; officers move anyone anywhere. Capacity is
 * shown and warned about but never enforced — the game is the real constraint
 * and officers may knowingly overfill a club mid-negotiation.
 */
function RosterEditor() {
  const [planId, setPlanId] = useState<number | null>(null);
  const [entries, setEntries] = useState<RosterEntry[]>([]);
  const [clubs, setClubs] = useState<RosterClub[]>([]);
  const [status, setStatus] = useState<string>("draft");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<RosterEntry | null>(null);

  const reload = useCallback(() => {
    api<{
      plan: { id: number; status: string };
      entries: RosterEntry[];
      clubs: RosterClub[];
    }>("roster")
      .then((r) => {
        setPlanId(r.plan.id);
        setStatus(r.plan.status);
        setEntries(r.entries);
        setClubs(r.clubs);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(reload, [reload]);

  const sensors = useSensors(
    // A small threshold so a tap on a member still reads as a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const byClub = useMemo(() => {
    const map = new Map<number | null, RosterEntry[]>();
    for (const club of clubs) map.set(club.circle_id, []);
    map.set(null, []);
    for (const entry of entries) {
      const list = map.get(entry.circle_id) ?? map.get(null)!;
      list.push(entry);
    }
    for (const list of map.values()) list.sort((a, b) => a.position - b.position);
    return map;
  }, [entries, clubs]);

  const changed = entries.filter((e) => e.source === "manual").length;

  function onDragStart(event: DragStartEvent) {
    setDragging(entries.find((e) => e.friend_viewer_id === Number(event.active.id)) ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const memberId = Number(event.active.id);
    const overId = event.over?.id;
    if (overId === undefined || overId === null) return;

    const targetClub = String(overId).startsWith("club-")
      ? Number(String(overId).slice(5))
      : null;

    const entry = entries.find((e) => e.friend_viewer_id === memberId);
    if (!entry || entry.circle_id === targetClub) return;

    const next = entries.map((e) =>
      e.friend_viewer_id === memberId
        ? { ...e, circle_id: targetClub, source: "manual" as const }
        : e,
    );
    setEntries(next);

    setSaving(true);
    try {
      await api("roster", {
        method: "PUT",
        body: JSON.stringify({
          planId,
          moves: [{ friendViewerId: memberId, circleId: targetClub, position: 999 }],
        }),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      reload();
    } finally {
      setSaving(false);
    }
  }

  if (error) return <ErrorNote message={error} />;
  if (!planId) return <Spinner label="Building the proposed roster" />;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Ribbon>Proposed roster</Ribbon>
        {status === "final" && (
          <span className="capsule bg-teal-500 px-2.5 py-0.5 text-xs font-semibold text-cream-50">
            finalised
          </span>
        )}
        <span className="text-xs text-ink-400">
          {changed > 0 ? `${changed} moved by hand` : "straight from the projection"}
        </span>
        {saving && <span className="text-xs text-teal-700">saving…</span>}

        <div className="ml-auto flex gap-2">
          <Button
            tone="quiet"
            title="Discard hand edits and reseed from the projection"
            onClick={async () => {
              await api("roster", { method: "POST", body: JSON.stringify({ action: "reset" }) });
              reload();
            }}
          >
            <span className="flex items-center gap-1.5">
              <RotateCcw size={13} /> Reset
            </span>
          </Button>
          <Button
            onClick={async () => {
              await api("roster", { method: "POST", body: JSON.stringify({ action: "finalise" }) });
              reload();
            }}
          >
            Finalise
          </Button>
        </div>
      </div>

      <p className="text-sm text-ink-500">
        Drag anyone into any club. The projection is a proposal — this is what actually
        gets executed.
      </p>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {clubs.map((club) => (
            <ClubColumn
              key={club.circle_id}
              club={club}
              entries={byClub.get(club.circle_id) ?? []}
            />
          ))}
          <ClubColumn club={null} entries={byClub.get(null) ?? []} />
        </div>

        {/* Follows the cursor across columns; without it the card stays clipped
            inside its own scrolling column. */}
        <DragOverlay>{dragging ? <MemberChip entry={dragging} /> : null}</DragOverlay>
      </DndContext>
    </section>
  );
}

function ClubColumn({ club, entries }: { club: RosterClub | null; entries: RosterEntry[] }) {
  const id = club ? `club-${club.circle_id}` : "club-none";
  const { setNodeRef, isOver } = useDroppable({ id });
  const over = club ? entries.length > club.capacity : false;

  return (
    <div
      ref={setNodeRef}
      className={`card p-2 transition-colors ${isOver ? "border-teal-400 bg-teal-50" : ""}`}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        {club ? (
          <ClubChip name={club.name} slotOrder={club.slot_order} />
        ) : (
          <span className="capsule bg-cream-300 px-2.5 py-0.5 text-xs font-semibold text-ink-700">
            Unplaced
          </span>
        )}
        <span className={`tnum ml-auto text-xs ${over ? "font-bold text-coral-700" : "text-ink-400"}`}>
          {entries.length}
          {club ? `/${club.capacity}` : ""}
        </span>
      </div>

      {/* A warning, not a block: officers may knowingly overfill. */}
      {over && (
        <p className="mb-2 px-1 text-[11px] font-semibold text-coral-700">
          over capacity by {entries.length - club!.capacity}
        </p>
      )}

      <ul className="space-y-1">
        {entries.map((entry) => (
          <MemberCard key={entry.friend_viewer_id} entry={entry} />
        ))}
        {entries.length === 0 && (
          <li className="px-1 py-3 text-center text-xs text-ink-400">drop here</li>
        )}
      </ul>
    </div>
  );
}

/**
 * Draggable, not sortable: members move between clubs, and order within a club
 * carries no meaning — it is rebuilt from rank. `useSortable` would also need a
 * SortableContext wrapper it never had.
 */
function MemberCard({ entry }: { entry: RosterEntry }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: entry.friend_viewer_id,
  });

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.35 : 1 }}
      className="cursor-grab active:cursor-grabbing"
    >
      <MemberChip entry={entry} />
    </li>
  );
}

function MemberChip({ entry }: { entry: RosterEntry }) {
  const moved = entry.source === "manual" && entry.circle_id !== entry.projected_circle_id;

  return (
    <span
      className={`capsule flex items-center gap-2 px-3 py-1.5 text-sm ${
        moved ? "bg-lav-200" : "bg-cream-200"
      }`}
      title={moved ? "Moved by hand from the projection" : undefined}
    >
      <span className="min-w-0 flex-1 truncate font-semibold text-ink-900">{entry.name}</span>
      <span className="tnum text-xs text-ink-500">
        {entry.mtd_avg ? compactFans(entry.mtd_avg) : "—"}
      </span>
    </span>
  );
}
