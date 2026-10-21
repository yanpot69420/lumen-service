import { useUser } from "@/auth/session";
import { PageBody, PageHeader } from "@/components/layout/app-shell";
import { PhotoManager } from "@/components/photos";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { useServiceAction } from "@/components/use-service-action";
import { db, uid } from "@/db/db";
import { getSetting, setSetting } from "@/db/settings";
import { createTicket } from "@/db/tickets";
import type { Customer, Ticket } from "@/db/types";
import { cn } from "@/lib/cn";
import {
  COMPLAINTS, PHONE_BRANDS, complaintText, customerChoices, customerForPhone,
  deviceLabel, findCustomers, parseDevice, type CustomerChoice,
} from "@/lib/service-intake";
import { waLink, waPhone } from "@/lib/wa";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowLeft, Check, CheckCircle2, ClipboardList, MessageCircle, Plus, Printer, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

const KELENGKAPAN = ["Charger", "Kartu SIM", "Memory Card", "Casing", "SIM Tray"];
const DRAFT_KEY = "draftServisBaru";
const DRAFT_PHOTO_REF = { refType: "draft" as const, refId: "servis-baru" };
const EMPTY = { customerId: "", customerName: "", phone: "", device: "", keluhan: "" };
const SECTION = "space-y-4 rounded-[1.5rem] border border-transparent bg-white p-5 lg:space-y-3 lg:rounded-2xl lg:border-slate-200 lg:p-4";
const SECTION_TITLE = "flex items-center gap-3 text-base font-bold text-brand-950 lg:gap-1 lg:text-sm";
const SECTION_NUMBER = "inline-flex size-8 items-center justify-center rounded-xl bg-[#f4f5f0] text-xs text-brand-700 lg:inline lg:size-auto lg:rounded-none lg:bg-transparent lg:text-sm lg:text-slate-900";
let activeIntakeSession: symbol | undefined;
type Draft = { f: typeof EMPTY; kelengkapan: string[]; complaints: string[] };
const emptyDraft = (): Draft => ({ f: { ...EMPTY }, kelengkapan: [], complaints: [] });
const copyDraft = (draft: Draft): Draft => ({ f: { ...draft.f }, kelengkapan: [...draft.kelengkapan], complaints: [...draft.complaints] });
const draftValue = (draft: Draft) => !Object.values(draft.f).some(Boolean) && !draft.kelengkapan.length && !draft.complaints.length ? "" : JSON.stringify(draft);

export function ServisBaruPage() {
  const user = useUser();
  const toast = useToast();
  const { run } = useServiceAction();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [f, setF] = useState(EMPTY);
  const [kelengkapan, setKelengkapan] = useState<string[]>([]);
  const [complaints, setComplaints] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  const [undoBusy, setUndoBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [created, setCreated] = useState<Ticket>();
  const [pendingCustomer, setPendingCustomer] = useState<Customer>();
  const [search, setSearch] = useState<"phone" | "customerName" | null>(null);
  const autoName = useRef("");
  const handledCustomerRequest = useRef<string | null>(null);
  const requestId = useRef(uid());
  const saving = useRef(false);
  const undoing = useRef(false);
  const undoCount = useRef(0);
  const phoneInput = useRef<HTMLInputElement>(null);
  const draft = useRef<Draft>(emptyDraft());
  const persisted = useRef({ draft: emptyDraft(), revision: 0 });
  const revision = useRef(0);
  const revisionCounter = useRef(0);
  const generation = useRef(0);
  const mounted = useRef(true);
  const intakeSession = useRef(Symbol("service-intake"));
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftQueue = useRef<Promise<void>>(Promise.resolve());
  const draftLabel = useRef("Draft nota diperbarui");
  const flushRef = useRef<() => Promise<void>>(async () => {});

  const history = useLiveQuery(() => db.tickets.orderBy("createdAt").reverse().toArray(), []);
  const profiles = useLiveQuery(() => db.customers.toArray(), []);
  const units = useLiveQuery(() => db.units.toArray(), []);
  const customers = useMemo(() => {
    const saved = (profiles ?? []).map((c): CustomerChoice => ({ id: c.id, customerName: c.name, phone: c.phone, createdAt: c.updatedAt, isRegular: c.isRegular }));
    const savedIds = new Set(saved.map((c) => c.id));
    const key = (c: CustomerChoice) => `${waPhone(c.phone)}|${c.customerName.trim().replace(/\s+/g, " ").toLowerCase()}`;
    const identities = new Set(saved.map(key));
    const legacy = customerChoices((history ?? []).filter((t) => !t.customerId || !savedIds.has(t.customerId))).filter((c) => !identities.has(key(c)));
    return [...saved.sort((a, b) => b.createdAt - a.createdAt), ...legacy];
  }, [history, profiles]);
  const selectedCustomer = profiles?.find((c) => c.id === f.customerId);
  const devices = useMemo(() => [...(history ?? []), ...(units ?? [])], [history, units]);
  const deviceOptions = useMemo(() => [...new Set([
    ...devices.map(deviceLabel), ...PHONE_BRANDS,
  ])].filter(Boolean), [devices]);
  const suggestions = search ? findCustomers(customers, f[search]) : [];
  const device = parseDevice(f.device, devices);
  const keluhan = complaintText(complaints, f.keluhan);
  const photoCount = useLiveQuery(() => db.photos.where(DRAFT_PHOTO_REF).count(), []);
  const valid = !!(f.customerName.trim() && device.brand && keluhan && (photoCount ?? 0) > 0);
  const completedSections = [!!f.customerName.trim(), !!device.brand, !!keluhan, (photoCount ?? 0) > 0];

  useEffect(() => {
    if (loaded && window.matchMedia("(min-width: 1024px)").matches) phoneInput.current?.focus({ preventScroll: true });
  }, [loaded]);

  useEffect(() => {
    const start = () => {
      if (undoing.current) return;
      if (created) nextTicket();
      else document.getElementById("intake-customer")?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.addEventListener("lumen:new-service", start);
    return () => window.removeEventListener("lumen:new-service", start);
  }, [created]);

  useEffect(() => {
    (async () => {
      try {
        const raw = await getSetting(DRAFT_KEY);
        if (raw) {
          const d = JSON.parse(raw);
          // Read the previous form's draft too, without carrying financial fields forward.
          const restoredDraft: Draft = { f: {
            customerId: typeof d.f?.customerId === "string" ? d.f.customerId : "",
            customerName: typeof d.f?.customerName === "string" ? d.f.customerName : "",
            phone: typeof d.f?.phone === "string" ? d.f.phone : "",
            device: typeof d.f?.device === "string" ? d.f.device : deviceLabel({ brand: d.f?.brand ?? "", model: d.f?.model ?? "" }),
            keluhan: typeof d.f?.keluhan === "string" ? d.f.keluhan : "",
          }, kelengkapan: Array.isArray(d.kelengkapan) ? d.kelengkapan.filter((x: unknown) => typeof x === "string") : [], complaints: Array.isArray(d.complaints) ? d.complaints.filter((x: unknown) => typeof x === "string") : [] };
          applyDraft(restoredDraft, 0);
          persisted.current = { draft: copyDraft(restoredDraft), revision: 0 };
          setRestored(true);
        }
      } catch {
        /* Draft korup — abaikan. */
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    activeIntakeSession = intakeSession.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (draftTimer.current) clearTimeout(draftTimer.current);
      if (!saving.current) void flushRef.current().catch(() => {});
    };
  }, []);

  // Do not mix a new customer's identity with another customer's unfinished draft.
  useEffect(() => {
    const requested = params.get("customer");
    if (!requested) { handledCustomerRequest.current = null; return; }
    if (undoing.current) return;
    if (!loaded || profiles === undefined || photoCount === undefined || handledCustomerRequest.current === requested) return;
    handledCustomerRequest.current = requested;
    const customer = profiles.find((c) => c.id === requested);
    if (customer) {
      const hasDraft = Object.values(f).some(Boolean) || kelengkapan.length > 0 || complaints.length > 0 || photoCount > 0;
      const sameCustomer = f.customerId === customer.id || (customer.phoneNormalized && waPhone(f.phone) === customer.phoneNormalized && f.customerName.trim().toLowerCase() === customer.name.toLowerCase());
      if (hasDraft && !sameCustomer) {
        setPendingCustomer(customer);
      } else {
        editDraft({ ...draft.current, f: { ...draft.current.f, customerId: customer.id, customerName: customer.name, phone: customer.phone } }, "Pelanggan dipilih");
        void flushDraft().catch(() => {});
        autoName.current = customer.name;
        setSearch(null);
      }
    } else {
      toast("Profil pelanggan tidak ditemukan. Pilih pelanggan kembali.", "error");
    }
    const next = new URLSearchParams(params);
    next.delete("customer");
    setParams(next, { replace: true });
  }, [loaded, profiles, photoCount, f, kelengkapan, complaints, params, setParams, toast, undoBusy]);

  function applyDraft(next: Draft, nextRevision = ++revisionCounter.current) {
    draft.current = copyDraft(next);
    revision.current = nextRevision;
    if (!mounted.current) return;
    setF(next.f);
    setKelengkapan(next.kelengkapan);
    setComplaints(next.complaints);
  }

  function editDraft(next: Draft, message: string) {
    if (undoing.current) return;
    if (draftValue(next) === draftValue(draft.current)) return;
    applyDraft(next);
    draftLabel.current = message;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => { void flushDraft().catch(() => {}); }, 600);
  }

  function assertDraftUnchanged(expectedGeneration: number, expectedRevision: number) {
    if (activeIntakeSession !== intakeSession.current || generation.current !== expectedGeneration || revision.current !== expectedRevision) {
      throw new Error("Draft sudah berubah. Batalkan perubahan terbaru terlebih dahulu.");
    }
  }

  function onUndoBusy(value: boolean) {
    undoCount.current = Math.max(0, undoCount.current + (value ? 1 : -1));
    undoing.current = undoCount.current > 0;
    if (mounted.current) setUndoBusy(undoing.current);
  }

  function flushDraft(): Promise<void> {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const next = copyDraft(draft.current);
    const nextRevision = revision.current;
    const expectedGeneration = generation.current;
    const message = draftLabel.current;
    const task = draftQueue.current.then(async () => {
      if (draftValue(next) === draftValue(persisted.current.draft)) return;
      const before = { draft: copyDraft(persisted.current.draft), revision: persisted.current.revision };
      await run(() => setSetting(DRAFT_KEY, draftValue(next)), {
        pending: "Menyimpan draft…", success: message,
        onUndoBusy,
        beforeUndo: () => assertDraftUnchanged(expectedGeneration, nextRevision),
        onUndo: () => {
          if (activeIntakeSession !== intakeSession.current) return;
          persisted.current = before;
          applyDraft(before.draft, before.revision);
          autoName.current = before.draft.f.customerId ? before.draft.f.customerName : "";
          if (mounted.current) setSearch(null);
        },
      });
      persisted.current = { draft: next, revision: nextRevision };
    });
    draftQueue.current = task.catch(() => {});
    return task;
  }
  flushRef.current = flushDraft;

  function chooseCustomer(customer: CustomerChoice) {
    if (undoing.current) return;
    editDraft({ ...draft.current, f: { ...draft.current.f, customerId: customer.id ?? "", customerName: customer.customerName, phone: customer.phone } }, "Pelanggan dipilih");
    void flushDraft().catch(() => {});
    autoName.current = customer.customerName;
    setSearch(null);
  }

  function changePhone(phone: string) {
    if (undoing.current) return;
    const match = customerForPhone(customers, phone);
    const current = draft.current.f;
    const name = !current.customerName.trim() || current.customerName === autoName.current ? (match?.customerName ?? "") : current.customerName;
    editDraft({ ...draft.current, f: { ...current, phone, customerName: name, customerId: match && name === match.customerName ? match.id ?? "" : "" } }, "Nomor WhatsApp diperbarui di draft");
    autoName.current = match?.customerName ?? "";
    setSearch("phone");
  }

  async function clearDraft(next = emptyDraft()) {
    if (busy || photoBusy || saving.current || undoing.current) return;
    setBusy(true);
    try {
      await flushDraft();
      const before = { draft: copyDraft(persisted.current.draft), revision: persisted.current.revision };
      const expectedGeneration = generation.current;
      const nextRevision = ++revisionCounter.current;
      await run(async () => {
        await setSetting(DRAFT_KEY, draftValue(next));
        const photoIds = await db.photos.where(DRAFT_PHOTO_REF).primaryKeys();
        await db.photos.bulkDelete(photoIds);
      }, {
        pending: "Menghapus draft…", success: next.f.customerId ? "Draft diganti untuk pelanggan terpilih" : "Draft nota dibuang",
        onUndoBusy,
        beforeUndo: () => assertDraftUnchanged(expectedGeneration, nextRevision),
        onUndo: () => {
          if (activeIntakeSession !== intakeSession.current) return;
          persisted.current = before;
          applyDraft(before.draft, before.revision);
          autoName.current = before.draft.f.customerId ? before.draft.f.customerName : "";
          if (mounted.current) { setRestored(true); setSearch(null); }
        },
      });
      persisted.current = { draft: copyDraft(next), revision: nextRevision };
      applyDraft(next, nextRevision);
      setRestored(false);
      setSearch(null);
      autoName.current = next.f.customerId ? next.f.customerName : "";
      setPendingCustomer(undefined);
    } catch {
      // The action reports its error in the snackbar.
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!valid || photoBusy || saving.current || undoing.current) return;
    saving.current = true;
    setBusy(true);
    setSearch(null);
    try {
      await flushDraft();
      const submitted = { draft: copyDraft(draft.current), revision: revision.current };
      const expectedGeneration = generation.current;
      const submittedRequest = requestId.current;
      const ticket = await run(() => createTicket(user, {
        customerId: f.customerId || undefined,
        customerName: f.customerName.trim(), phone: f.phone.trim(), ...device,
        keluhan, kelengkapan, estimasi: 0, dp: 0,
      }, [], "tunai", undefined, "servis-baru", submittedRequest), {
        pending: "Menyimpan nota…", success: (saved) => `Nota ${saved.noNota} dibuat`,
        onUndoBusy,
        beforeUndo: () => assertDraftUnchanged(expectedGeneration, submitted.revision),
        onUndo: () => {
          if (activeIntakeSession !== intakeSession.current) return;
          persisted.current = submitted;
          applyDraft(submitted.draft, submitted.revision);
          requestId.current = submittedRequest;
          saving.current = false;
          if (mounted.current) { setCreated(undefined); setRestored(true); }
          else navigate("/app/servis/baru");
        },
      });
      persisted.current = { draft: emptyDraft(), revision: submitted.revision };
      setCreated(ticket);
      setRestored(false);
    } catch {
      saving.current = false;
    } finally {
      setBusy(false);
    }
  }

  function nextTicket() {
    if (undoing.current) return;
    generation.current++;
    applyDraft(emptyDraft());
    persisted.current = { draft: emptyDraft(), revision: revision.current };
    autoName.current = "";
    requestId.current = uid();
    saving.current = false;
    setCreated(undefined);
    setTimeout(() => phoneInput.current?.focus(), 0);
  }

  function customerSuggestions(field: "phone" | "customerName") {
    if (search !== field || !suggestions.length) return null;
    return (
      <div className="mt-2 overflow-hidden rounded-xl border border-slate-200" aria-label="Pelanggan yang cocok">
        {suggestions.map((c) => (
          <button
            key={c.id ?? `${c.customerName}|${c.phone}`}
            type="button"
            className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-3 text-left text-sm hover:bg-slate-50 focus:bg-sky-50 lg:min-h-0 lg:py-2"
            onClick={() => chooseCustomer(c)}
          >
            <span className="font-medium">{c.customerName}{c.isRegular && <span className="ml-2 text-xs text-amber-700">Langganan</span>}</span>
            <span className="text-xs text-slate-500">{c.phone || "Tanpa WA"}</span>
          </button>
        ))}
      </div>
    );
  }

  if (!loaded) return null;

  return (
    <>
      <PageHeader
        title="Nota Servis Baru"
        back={<Link to="/app/servis" aria-label="Kembali ke daftar servis" className="inline-flex size-11 items-center justify-center rounded-2xl bg-white text-slate-600 hover:text-slate-900 lg:size-auto lg:rounded-none lg:bg-transparent lg:text-slate-400"><ArrowLeft className="size-5" /></Link>}
      />
      <PageBody>
        {created ? (
          <div className="mx-auto max-w-lg space-y-5 rounded-[1.75rem] border border-emerald-200 bg-white px-5 py-8 text-center lg:rounded-2xl lg:p-6" role="status">
            <span className="mx-auto flex size-16 items-center justify-center rounded-[1.5rem] bg-emerald-50 lg:size-auto lg:bg-transparent"><CheckCircle2 className="size-10 text-emerald-600" /></span>
            <div>
              <h2 className="text-xl font-bold lg:text-lg">Nota berhasil disimpan</h2>
              <p className="mt-1 font-semibold text-brand-700">{created.noNota}</p>
              <p className="mt-1 text-sm text-slate-500">{created.customerName} · {deviceLabel(created)}</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Link to={`/app/nota/servis/${created.id}`}><Button variant="outline" className="w-full"><Printer /> Cetak nota</Button></Link>
              <Button variant="outline" disabled={!created.phone} onClick={() => window.open(waLink(created.phone, [
                `Nota servis: ${created.noNota}`, `Pelanggan: ${created.customerName}`,
                `HP: ${deviceLabel(created)}`, `Keluhan: ${created.keluhan}`,
                "HP sudah diterima untuk pemeriksaan. Kami akan menghubungi Anda untuk konfirmasi biaya.",
              ].join("\n")), "_blank", "noopener,noreferrer")}><MessageCircle /> WhatsApp</Button>
            </div>
            <Button size="lg" className="w-full" disabled={undoBusy} onClick={nextTicket}>{undoBusy ? "Membatalkan…" : <><Plus /> Nota berikutnya</>}</Button>
            <Link className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline lg:min-h-0" to={`/app/servis/${created.id}`}>Lihat detail nota</Link>
          </div>
        ) : (
          <form className="space-y-4 pb-24" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <section className="rounded-[1.75rem] bg-brand-950 p-5 text-white lg:hidden" aria-label="Persiapan nota baru">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Penerimaan servis</p>
                  <h2 className="mt-2 text-[1.4rem] font-bold leading-tight">Lengkapi 4 bagian,<br />nota siap disimpan.</h2>
                </div>
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-accent-400"><ClipboardList className="size-5" /></span>
              </div>
              <div className="mt-5 flex items-center justify-between">
                <p className="text-xs text-white/60">Draft tersimpan otomatis</p>
                <p className="text-xs font-semibold text-accent-400">{completedSections.filter(Boolean).length} / 4 lengkap</p>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2" aria-label={`${completedSections.filter(Boolean).length} dari 4 bagian lengkap`}>
                {completedSections.map((complete, i) => <span key={i} className={cn("h-1 rounded-full", complete ? "bg-accent-400" : "bg-white/15")} />)}
              </div>
            </section>
            {restored && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                Draft terakhir dipulihkan.
                <button type="button" disabled={busy || photoBusy || undoBusy} onClick={() => void clearDraft()} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 font-semibold underline lg:min-h-0 lg:px-0"><Trash2 className="size-3.5" /> Buang draft</button>
              </div>
            )}
            <fieldset disabled={busy || undoBusy} className="grid min-w-0 gap-4 lg:grid-cols-2">
              <section className={SECTION} aria-labelledby="intake-customer">
                <h2 id="intake-customer" className={SECTION_TITLE}><span className={SECTION_NUMBER}>1<span className="hidden lg:inline">.</span></span> Pelanggan{completedSections[0] && <Check className="ml-auto size-4 text-emerald-600 lg:hidden" />}</h2>
                <div>
                  <Field label="No. WhatsApp" hint="Ketik nomor atau cari pelanggan lewat nama.">
                    <Input ref={phoneInput} type="tel" autoComplete="off" placeholder="08xxxxxxxxxx" value={f.phone} onFocus={() => setSearch("phone")} onChange={(e) => changePhone(e.target.value)} onBlur={() => void flushDraft().catch(() => {})} onKeyDown={(e) => { if (e.key === "Escape") setSearch(null); }} />
                  </Field>
                  {customerSuggestions("phone")}
                </div>
                <div>
                  <Field label="Nama pelanggan" required>
                    <Input required autoComplete="off" placeholder="Nama pelanggan" value={f.customerName} onFocus={() => setSearch("customerName")} onChange={(e) => { autoName.current = ""; editDraft({ ...draft.current, f: { ...draft.current.f, customerId: "", customerName: e.target.value } }, "Nama pelanggan diperbarui di draft"); setSearch("customerName"); }} onBlur={() => void flushDraft().catch(() => {})} onKeyDown={(e) => { if (e.key === "Escape") setSearch(null); }} />
                  </Field>
                  {customerSuggestions("customerName")}
                </div>
                {selectedCustomer && <p className="text-xs text-brand-700">{selectedCustomer.isRegular ? "Pelanggan langganan" : "Profil pelanggan terpilih"} · <Link className="underline" to={`/app/pelanggan/${selectedCustomer.id}`}>Lihat profil</Link></p>}
              </section>
              <section className={SECTION} aria-labelledby="intake-device" onFocus={() => setSearch(null)}>
                <h2 id="intake-device" className={SECTION_TITLE}><span className={SECTION_NUMBER}>2<span className="hidden lg:inline">.</span></span> Perangkat & kelengkapan{completedSections[1] && <Check className="ml-auto size-4 text-emerald-600 lg:hidden" />}</h2>
                <Field label="Merek / tipe HP" required hint="Pilih dari riwayat atau ketik perangkat baru.">
                  <Input required list="intake-devices" autoComplete="off" placeholder="Contoh: Samsung A54" value={f.device} onChange={(e) => editDraft({ ...draft.current, f: { ...draft.current.f, device: e.target.value } }, "Perangkat diperbarui di draft")} onBlur={() => void flushDraft().catch(() => {})} />
                  <datalist id="intake-devices">{deviceOptions.map((name) => <option key={name} value={name} />)}</datalist>
                </Field>
                <div>
                  <p className="mb-2 text-xs font-medium text-slate-600">Kelengkapan yang dititipkan</p>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Kelengkapan yang dititipkan">
                    {KELENGKAPAN.map((k) => (
                      <button key={k} type="button" aria-pressed={kelengkapan.includes(k)} onClick={() => { const xs = draft.current.kelengkapan; editDraft({ ...draft.current, kelengkapan: xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k] }, "Kelengkapan diperbarui di draft"); void flushDraft().catch(() => {}); }} className={cn("min-h-11 rounded-2xl border px-3 py-2 text-xs font-medium lg:min-h-0 lg:rounded-full", kelengkapan.includes(k) ? "border-brand-950 bg-brand-950 text-white" : "border-slate-200 text-slate-600")}>{k}</button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{kelengkapan.length ? kelengkapan.join(", ") : "Tanpa kelengkapan tambahan"}</p>
                </div>
              </section>
              <section className={SECTION} aria-labelledby="intake-complaint" onFocus={() => setSearch(null)}>
                <h2 id="intake-complaint" className={SECTION_TITLE}><span className={SECTION_NUMBER}>3<span className="hidden lg:inline">.</span></span> Keluhan <span className="text-red-500">*</span>{completedSections[2] && <Check className="ml-auto size-4 text-emerald-600 lg:hidden" />}</h2>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Keluhan umum">
                  {COMPLAINTS.map((c) => (
                    <button key={c} type="button" aria-pressed={complaints.includes(c)} onClick={() => { const xs = draft.current.complaints; editDraft({ ...draft.current, complaints: xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c] }, "Keluhan diperbarui di draft"); void flushDraft().catch(() => {}); }} className={cn("min-h-11 rounded-2xl border px-3 py-2 text-xs font-medium lg:min-h-0 lg:rounded-full", complaints.includes(c) ? "border-brand-950 bg-brand-950 text-white" : "border-slate-200 text-slate-600")}>{c}</button>
                  ))}
                </div>
                <Field label="Keluhan lain / catatan" hint="Boleh dikosongkan jika sudah memilih keluhan di atas.">
                  <Textarea rows={2} className="min-h-16" placeholder="Contoh: layar bergaris setelah jatuh" value={f.keluhan} onChange={(e) => editDraft({ ...draft.current, f: { ...draft.current.f, keluhan: e.target.value } }, "Catatan diperbarui di draft")} onBlur={() => void flushDraft().catch(() => {})} />
                </Field>
              </section>
              <section className={SECTION} aria-labelledby="intake-photo" onFocus={() => setSearch(null)}>
                <h2 id="intake-photo" className={SECTION_TITLE}><span className={SECTION_NUMBER}>4<span className="hidden lg:inline">.</span></span> Foto kondisi awal <span className="text-red-500">*</span>{completedSections[3] && <Check className="ml-auto size-4 text-emerald-600 lg:hidden" />}</h2>
                <p className="text-xs text-slate-500">Minimal satu foto. Ketuk kamera untuk mengambil foto HP.</p>
                <PhotoManager refType={DRAFT_PHOTO_REF.refType} refId={DRAFT_PHOTO_REF.refId} label="Ambil foto" canDelete serviceUndo onBusyChange={setPhotoBusy} />
              </section>
            </fieldset>
            <div data-service-savebar className="fixed inset-x-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:bottom-0 lg:left-60">
              <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 sm:gap-4 lg:px-4">
                <p className="flex-1 text-xs text-slate-500" aria-live="polite">{undoBusy ? "Membatalkan perubahan…" : busy ? "Menyimpan nota…" : photoBusy ? "Menyiapkan foto…" : valid ? "Siap disimpan · draft tersimpan otomatis" : "Lengkapi nama, perangkat, keluhan, dan satu foto."}</p>
                <Button type="submit" size="lg" className="w-full sm:w-auto sm:min-w-48" disabled={!valid || busy || photoBusy || undoBusy}>{undoBusy ? "Membatalkan…" : busy ? "Menyimpan…" : "Simpan Nota"}</Button>
              </div>
            </div>
          </form>
        )}
      </PageBody>
      <Modal open={!!pendingCustomer} onClose={() => setPendingCustomer(undefined)} title="Ada draft nota yang belum selesai">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Anda memiliki draft sebelumnya. Lanjutkan draft itu, atau buang isian dan foto draft untuk membuat nota baru bagi {pendingCustomer?.name}.</p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setPendingCustomer(undefined)}>Lanjutkan Draft</Button>
            <Button disabled={busy || photoBusy || undoBusy} onClick={async () => {
              if (!pendingCustomer || busy || photoBusy || undoing.current) return;
              const customer = pendingCustomer;
              await clearDraft({ ...emptyDraft(), f: { ...EMPTY, customerId: customer.id, customerName: customer.name, phone: customer.phone } });
            }}>Buang Draft & Buat Nota Baru</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
