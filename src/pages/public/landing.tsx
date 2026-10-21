import { BrandMark } from "@/components/brand";
import { FirstPhoto } from "@/components/photos";
import { publicProfile, usePublicCatalog, type PublicProduct } from "@/db/public";
import { getSetting } from "@/db/settings";
import { isCloud } from "@/db/supabase";
import { rp } from "@/lib/format";
import { waLink } from "@/lib/wa";
import { BRAND_NAME, storeDisplayName } from "@/lib/brand";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  Clock,
  MapPin,
  MessageCircle,
  Search,
  ShieldCheck,
  Smartphone,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export function useStoreProfile() {
  const [s, setS] = useState({
    name: BRAND_NAME,
    tagline: "",
    address: "",
    phone: "",
    hours: "",
    error: "",
  });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const p = isCloud ? await publicProfile() : Object.fromEntries(
        await Promise.all(["storeName", "storeTagline", "storeAddress", "storePhone", "storeHours"].map(async (key) => [key, await getSetting(key)])),
      );
      if (!cancelled) setS({
        name: storeDisplayName(p.storeName),
        tagline: p.storeTagline || "",
        address: p.storeAddress || "",
        phone: p.storePhone || "",
        hours: p.storeHours || "",
        error: "",
      });
    })().catch((error) => {
      if (!cancelled) setS((current) => ({ ...current, error: error instanceof Error ? error.message : "Profil toko belum dapat dimuat." }));
    });
    return () => { cancelled = true; };
  }, []);
  return s;
}

export function PublicNav({ active }: { active: "home" | "katalog" | "cek"; }) {
  const links = [
    { key: "home", to: "/", label: "Beranda" },
    { key: "katalog", to: "/katalog", label: "Katalog HP" },
    { key: "cek", to: "/cek", label: "Cek servis" },
  ] as const;
  return (
    <header className="sticky top-0 z-30 border-b border-brand-950/8 bg-slate-50/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-x-6 px-5 sm:px-8">
        <Link to="/" aria-label={`${BRAND_NAME} — beranda`} className="flex min-h-[72px] items-center gap-2.5">
          <BrandMark className="size-9 rounded-xl text-lg" />
          <span className="text-[15px] font-bold tracking-tight text-brand-950">{BRAND_NAME}</span>
        </Link>
        <Link to="/app/login" className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand-950 md:order-3">Area staf <ArrowUpRight className="size-3.5" /></Link>
        <nav aria-label="Navigasi publik" className="order-3 -mx-1 mb-3 grid w-[calc(100%+0.5rem)] grid-cols-3 gap-1 rounded-2xl border border-brand-950/6 bg-white/80 p-1 text-xs md:order-2 md:mb-0 md:flex md:w-auto md:border-0 md:bg-transparent md:text-[13px]">
          {links.map(({ key, to, label }) => (
            <Link key={key} to={to} aria-current={active === key ? "page" : undefined} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 font-medium transition-colors md:px-4 ${active === key ? "bg-brand-950 text-white" : "text-slate-500 hover:bg-brand-100 hover:text-brand-950"}`}>
              {key === "cek" && <Search className="size-3.5" />}{label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="bg-brand-950 text-white">
      <div className="mx-auto max-w-[1200px] px-5 pb-6 pt-10 sm:px-8 sm:pt-12">
        <div className="flex flex-col justify-between gap-7 border-b border-white/10 pb-8 sm:flex-row sm:items-start">
          <div>
            <Link to="/" className="inline-flex items-center gap-2.5"><BrandMark className="size-9 rounded-xl" /><span className="text-base font-semibold tracking-tight">{BRAND_NAME}</span></Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/65">Teman untuk urusan servis dan pilihan HP Anda.</p>
          </div>
          <nav aria-label="Tautan footer" className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-white/75">
            <Link className="inline-flex min-h-11 items-center hover:text-accent-400" to="/katalog">Katalog HP</Link>
            <Link className="inline-flex min-h-11 items-center hover:text-accent-400" to="/cek">Cek servis</Link>
            <Link className="inline-flex min-h-11 items-center gap-1 hover:text-accent-400" to="/app/login">Area staf <ArrowUpRight className="size-3.5" /></Link>
          </nav>
        </div>
        <div className="flex flex-col justify-between gap-2 pt-6 text-[11px] text-white/55 sm:flex-row">
          <p>© {new Date().getFullYear()} {BRAND_NAME}.</p>
          <p>Servis HP · Jual beli HP second</p>
        </div>
      </div>
    </footer>
  );
}

const services = [
  { icon: Wrench, number: "01", title: "Bantu HP kembali prima.", label: "Servis HP", desc: "Layar, baterai, kendala sistem, hingga perangkat mati. Ceritakan keluhannya, kami bantu periksa.", link: "Konsultasikan keluhan" },
  { icon: Smartphone, number: "02", title: "HP berikutnya, pilihan Anda.", label: "Jual beli HP second", desc: "Temukan pilihan unit, lihat kondisi dan harganya. Ingin menjual HP? Tanyakan juga kepada kami.", link: "Jelajahi katalog HP" },
  { icon: ClipboardCheck, number: "03", title: "Progres yang mudah diikuti.", label: "Pantau servis", desc: "Simpan nomor nota Anda. Cek perkembangan servis dengan nomor nota dan empat digit terakhir WhatsApp.", link: "Cek status servis" },
];

export function LandingPage() {
  const store = useStoreProfile();
  const { units, error: catalogError } = usePublicCatalog();
  const featured = units?.slice(0, 4);
  const chatHref = store.phone ? waLink(store.phone, `Halo ${store.name}, saya ingin bertanya tentang servis HP.`) : undefined;

  return (
    <div className="public-site min-h-dvh bg-slate-50 text-brand-950">
      <PublicNav active="home" />
      <main>
        {store.error && <div role="alert" className="mx-5 mt-5 max-w-[1136px] rounded-2xl border border-accent-200 bg-accent-50 px-5 py-3 text-sm text-accent-900 sm:mx-8 xl:mx-auto">Informasi konter belum dapat dimuat. Silakan coba kembali beberapa saat lagi.</div>}

        <section aria-labelledby="hero-title" className="relative isolate overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -right-40 -top-44 size-[650px] rounded-full bg-slate-200/80 blur-3xl" />
          <div className="relative mx-auto grid max-w-[1200px] items-center gap-8 px-5 pb-10 pt-10 sm:px-8 sm:pt-14 lg:min-h-[650px] lg:grid-cols-[1.08fr_1fr] lg:gap-12 lg:pb-16 lg:pt-14">
            <div className="max-w-[620px]">
              <p className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/80 px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[.12em] text-brand-700"><span className="size-1.5 rounded-full bg-brand-600" /> {store.name}</p>
              <h1 id="hero-title" className="mt-6 text-[clamp(2.5rem,5vw,4.25rem)] font-semibold leading-[1.08] tracking-[-.055em]">HP kembali prima.<br /><span className="relative inline-block text-brand-600">Aktivitas kembali<br className="hidden lg:block" /> lancar.<span aria-hidden className="absolute -bottom-1 left-0 -z-10 h-3 w-[82%] -rotate-1 rounded-full bg-accent-400/60 sm:h-4" /></span></h1>
              <p className="mt-6 max-w-[430px] text-sm leading-7 text-slate-600 sm:text-base sm:leading-8">{store.tagline || "Servis HP & jual beli HP second."} Dari keluhan perangkat hingga mencari HP berikutnya, mulai dari sini.</p>
              <div className="mt-7 flex flex-col gap-3 min-[400px]:flex-row sm:mt-8">
                {chatHref ? <a href={chatHref} target="_blank" rel="noreferrer" className="public-cta inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-brand-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-800"><MessageCircle className="size-[18px]" /> Chat WhatsApp <ArrowUpRight className="ml-2 size-4" /></a> : <a href="#kontak" className="public-cta inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-brand-950 px-5 text-sm font-semibold text-white hover:bg-brand-800"><MapPin className="size-[18px]" /> Informasi konter <ArrowDown className="ml-2 size-4" /></a>}
                <Link to="/cek" className="public-cta inline-flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white/60 px-5 text-sm font-semibold text-brand-950 transition-colors hover:bg-white"><Search className="size-[18px]" /> Cek servis</Link>
              </div>
              <div className="mt-7 flex flex-wrap gap-x-5 gap-y-3 text-[11px] font-medium text-slate-500 sm:mt-9">
                <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-brand-600" /> Nota digital</span>
                <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-brand-600" /> Status servis online</span>
                <span className="inline-flex items-center gap-1.5"><Check className="size-3.5 text-brand-600" /> Pilihan HP second</span>
              </div>
            </div>
            <ServiceIllustration />
          </div>
        </section>

        <section id="layanan" aria-labelledby="services-title" className="border-y border-slate-200 bg-white/55 py-12 sm:py-16 lg:py-20">
          <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-brand-600">Yang bisa kami bantu</p><h2 id="services-title" className="mt-3 max-w-lg text-3xl font-semibold leading-tight tracking-[-.045em] sm:text-[36px]">Satu tempat.<br />Banyak urusan HP beres.</h2></div>
              <p className="max-w-xs text-sm leading-7 text-slate-500">Pilih kebutuhan Anda, lalu lanjutkan dengan langkah yang mudah.</p>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-3 lg:mt-10 lg:gap-5">
              {services.map(({ icon: Icon, number, label, title, desc, link }, index) => (
                <article key={number} className="group flex flex-col rounded-[24px] border border-slate-200 bg-white p-6 transition-colors hover:border-brand-300 lg:p-7">
                  <div className="flex items-center justify-between"><span className="inline-flex size-12 items-center justify-center rounded-2xl bg-brand-100 text-brand-800"><Icon className="size-[22px]" /></span><span className="font-mono text-xs text-slate-400">{number}</span></div>
                  <p className="mt-7 text-[10px] font-semibold uppercase tracking-[.12em] text-brand-600">{label}</p>
                  <h3 className="mt-2 max-w-[230px] text-xl font-semibold leading-snug tracking-tight">{title}</h3>
                  <p className="mb-5 mt-3 text-[13px] leading-7 text-slate-500">{desc}</p>
                  {index === 0 ? <a href={chatHref || "#kontak"} target={chatHref ? "_blank" : undefined} rel={chatHref ? "noreferrer" : undefined} className="mt-auto inline-flex min-h-11 items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs font-semibold text-brand-800">{link}<ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></a> : <Link to={index === 1 ? "/katalog" : "/cek"} className="mt-auto inline-flex min-h-11 items-center justify-between gap-3 border-t border-slate-100 pt-4 text-xs font-semibold text-brand-800">{link}<ArrowUpRight className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" /></Link>}
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="status-title" className="mx-auto max-w-[1200px] px-5 py-12 sm:px-8 sm:py-16 lg:py-20">
          <div className="relative isolate overflow-hidden rounded-[28px] bg-brand-950 p-6 text-white sm:p-9 lg:grid lg:grid-cols-[1fr_1fr] lg:gap-14 lg:p-12">
            <div aria-hidden className="pointer-events-none absolute -bottom-32 -right-28 -z-10 size-96 rounded-full border-[60px] border-white/[.025]" />
            <div>
              <span className="inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.15em] text-accent-400"><span className="size-1.5 rounded-full bg-accent-400" /> Sudah titip servis?</span>
              <h2 id="status-title" className="mt-4 text-3xl font-semibold leading-tight tracking-[-.04em] sm:text-[36px]">Kabar HP Anda,<br /><span className="text-accent-400">tanpa harus menebak.</span></h2>
              <p className="mt-4 max-w-sm text-sm leading-7 text-white/70">Lihat perkembangan servis langsung dari HP Anda. Siapkan nota dan nomor WhatsApp yang dicatat saat penerimaan.</p>
              <Link to="/cek" className="mt-6 inline-flex min-h-12 items-center justify-center gap-3 rounded-2xl bg-accent-500 px-5 text-sm font-semibold text-brand-950 hover:bg-accent-400">Cek status sekarang <ArrowRight className="size-4" /></Link>
            </div>
            <ol className="mt-9 space-y-5 lg:my-auto">
              {[
                ["Siapkan nomor nota", "Gunakan nomor pada nota servis Anda."],
                ["Masukkan 4 digit terakhir WhatsApp", "Pakai nomor yang dicatat saat servis."],
                ["Lihat progres perangkat", "Status dan riwayat servis tersedia di satu halaman."],
              ].map(([title, desc], index) => <li key={title} className="flex items-start gap-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/5 text-xs font-semibold text-accent-400">0{index + 1}</span><div className="border-b border-white/10 pb-5"><h3 className="text-[13px] font-semibold">{title}</h3><p className="mt-1.5 text-xs leading-6 text-white/65">{desc}</p></div></li>)}
            </ol>
          </div>
        </section>

        <section aria-labelledby="catalog-title" className="border-y border-slate-200 bg-white/55 py-12 sm:py-16 lg:py-20">
          <div className="mx-auto max-w-[1200px] px-5 sm:px-8">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-brand-600">Pilihan perangkat</p><h2 id="catalog-title" className="mt-3 text-3xl font-semibold tracking-[-.045em] sm:text-[36px]">Temukan HP berikutnya.</h2><p className="mt-3 text-sm leading-7 text-slate-500">Lihat unit yang tersedia, cocokkan kebutuhan dan anggaran Anda.</p></div>
              <Link to="/katalog" className="inline-flex min-h-11 shrink-0 items-center gap-3 self-start rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-brand-800 hover:bg-brand-50 sm:self-auto">Semua katalog <ArrowUpRight className="size-4" /></Link>
            </div>
            {catalogError ? <div role="alert" className="mt-8 rounded-2xl border border-accent-200 bg-accent-50 p-5 text-sm leading-relaxed text-accent-900">Pilihan HP belum dapat dimuat. Coba buka katalog kembali beberapa saat lagi.</div> : units === undefined ? <div className="mt-8" role="status"><span className="sr-only">Memuat pilihan HP…</span><div aria-hidden className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="overflow-hidden rounded-[22px] border border-slate-200 bg-white motion-safe:animate-pulse"><div className="aspect-[5/4] bg-brand-100" /><div className="space-y-3 p-5"><div className="h-3 w-3/4 rounded-full bg-slate-100" /><div className="h-3 w-1/2 rounded-full bg-slate-100" /></div></div>)}</div></div> : featured?.length ? <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">{featured.map((unit) => <FeaturedProduct key={unit.kode} unit={unit} phone={store.phone} />)}</div> : <div className="mt-8 flex flex-col items-start gap-5 rounded-[24px] border border-slate-200 bg-white p-6 sm:flex-row sm:items-center sm:p-8"><span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-100 text-brand-700"><Smartphone className="size-6" /></span><div className="flex-1"><h3 className="font-semibold">Pilihan baru akan hadir di sini.</h3><p className="mt-2 text-sm leading-relaxed text-slate-500">Belum ada unit yang ditampilkan. Tanyakan pilihan HP yang Anda cari kepada kami.</p></div>{chatHref && <a href={waLink(store.phone, `Halo ${store.name}, saya ingin bertanya pilihan HP second yang tersedia.`)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-brand-950 px-4 text-xs font-semibold text-white hover:bg-brand-800">Tanya pilihan HP <ArrowUpRight className="size-4" /></a>}</div>}
          </div>
        </section>

        <section id="kontak" aria-labelledby="contact-title" className="mx-auto grid max-w-[1200px] scroll-mt-36 gap-10 px-5 py-12 sm:px-8 sm:py-16 md:scroll-mt-24 lg:grid-cols-2 lg:gap-20 lg:py-20">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.18em] text-brand-600">Sampai jumpa di konter</p>
            <h2 id="contact-title" className="mt-3 text-3xl font-semibold leading-tight tracking-[-.045em] sm:text-[36px]">Datang, cerita,<br />kita cek bersama.</h2>
            <p className="mt-4 max-w-sm text-sm leading-7 text-slate-500">Kunjungi {store.name} untuk konsultasi perangkat atau melihat pilihan HP secara langsung.</p>
            <dl className="mt-7 space-y-5">
              <div className="flex items-start gap-3.5"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-brand-700"><MapPin className="size-[18px]" /></span><div className="min-w-0"><dt className="text-xs font-semibold">Alamat konter</dt><dd className="mt-1.5 whitespace-pre-line break-words text-sm leading-6 text-slate-500">{store.address || "Informasi alamat akan segera tersedia."}</dd></div></div>
              <div className="flex items-start gap-3.5"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-brand-700"><Clock className="size-[18px]" /></span><div className="min-w-0"><dt className="text-xs font-semibold">Jam operasional</dt><dd className="mt-1.5 whitespace-pre-line break-words text-sm leading-6 text-slate-500">{store.hours || "Informasi jam buka akan segera tersedia."}</dd></div></div>
            </dl>
            {chatHref && <a href={chatHref} target="_blank" rel="noreferrer" className="mt-7 inline-flex min-h-12 items-center gap-3 rounded-2xl bg-accent-500 px-5 text-sm font-semibold text-brand-950 hover:bg-accent-400"><MessageCircle className="size-[18px]" /> Hubungi via WhatsApp <ArrowUpRight className="size-4" /></a>}
          </div>
          <div className="self-start rounded-[24px] border border-slate-200 bg-white p-5 sm:p-7">
            <h3 className="text-lg font-semibold tracking-tight">Sebelum berkunjung</h3>
            <p className="mb-3 mt-2 text-xs leading-6 text-slate-500">Beberapa hal yang mungkin ingin Anda ketahui.</p>
            {[
              { question: "Apa yang perlu dibawa saat servis?", answer: "Bawa perangkat dan ceritakan keluhan yang dialami. Setelah penerimaan, simpan nomor nota untuk mengecek status dan pengambilan perangkat." },
              { question: "Bagaimana cara melihat progres servis?", answer: <>Buka <Link to="/cek" className="font-semibold text-brand-700 underline underline-offset-4">Cek servis</Link>, lalu masukkan nomor nota dan empat digit terakhir nomor WhatsApp yang dicatat saat penerimaan.</> },
              { question: "Bagaimana melihat harga dan kondisi HP?", answer: <>Buka <Link to="/katalog" className="font-semibold text-brand-700 underline underline-offset-4">Katalog HP</Link> untuk melihat pilihan unit, varian, kondisi, dan harga. Tanyakan ketersediaannya kepada konter sebelum datang.</> },
            ].map(({ question, answer }) => <details key={question} className="group border-t border-slate-100"><summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 py-4 text-[13px] font-semibold [&::-webkit-details-marker]:hidden">{question}<ChevronDown className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" /></summary><p className="pb-5 pr-6 text-[13px] leading-7 text-slate-500">{answer}</p></details>)}
          </div>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}

/** Decorative service illustration: no real customer or ticket data. */
function ServiceIllustration() {
  return (
    <div aria-hidden className="relative mx-auto h-[390px] w-full max-w-[470px] select-none sm:h-[440px] lg:h-[500px]">
      <div className="absolute inset-x-2 bottom-3 top-4 rounded-[40px] bg-slate-200 sm:inset-x-4 sm:rounded-[48px]" />
      <div className="absolute right-10 top-12 size-40 rounded-full border border-slate-300/70 sm:right-8 sm:size-60" />
      <div className="absolute right-5 top-28 size-40 rounded-full border border-slate-300/50 sm:right-0 sm:size-60" />
      <div className="absolute bottom-10 left-9 size-24 rounded-[30px] bg-accent-400/75 rotate-[-15deg] sm:bottom-12 sm:left-12" />
      <div className="absolute left-1/2 top-7 h-[332px] w-[194px] -translate-x-1/2 rotate-[-7deg] rounded-[34px] border-[5px] border-brand-800 bg-brand-950 p-1.5 shadow-[12px_20px_45px_-15px_rgba(0,0,0,.35)] sm:top-8 sm:h-[370px] sm:w-[216px] sm:rounded-[38px] lg:top-12 lg:h-[394px] lg:w-[228px]">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[24px] bg-slate-50 px-4 pb-4 pt-6 sm:rounded-[28px]">
          <div className="absolute left-1/2 top-2 h-3.5 w-16 -translate-x-1/2 rounded-full bg-brand-950" />
          <div className="mt-2 flex items-center justify-between gap-2"><span className="text-[9px] font-bold tracking-tight">{BRAND_NAME}</span><span className="size-1.5 shrink-0 rounded-full bg-brand-500" /></div>
          <p className="mt-6 text-[8px] font-medium text-slate-500">Perangkat Anda, kami bantu rawat.</p>
          <p className="mt-2 text-[20px] font-semibold leading-tight tracking-tight text-brand-950">Kembali<br />terhubung.</p>
          <div className="relative my-4 flex flex-1 items-center justify-center rounded-[20px] bg-slate-100">
            <span className="absolute size-[84px] rounded-full border border-brand-300/60" />
            <span className="absolute size-[110px] rounded-full border border-brand-300/30" />
            <span className="relative flex size-16 items-center justify-center rounded-[22px] bg-brand-950 text-accent-400"><Wrench className="size-8" strokeWidth={1.5} /></span>
            <span className="absolute bottom-3 right-4 flex size-6 items-center justify-center rounded-full border-2 border-slate-100 bg-accent-500 text-brand-950"><Check className="size-3" strokeWidth={3} /></span>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-3"><Search className="size-3.5 text-brand-600" /><span className="text-[8px] font-semibold">Pantau progres servis</span><ArrowUpRight className="ml-auto size-3 text-brand-700" /></div>
        </div>
      </div>
      <div className="absolute left-0 top-[90px] flex items-center gap-2 rounded-2xl border border-white/80 bg-white p-3 shadow-[0_8px_30px_-12px_rgba(0,0,0,.15)] sm:top-28 sm:p-3.5 lg:top-[135px]"><span className="flex size-8 items-center justify-center rounded-xl bg-brand-100 text-brand-700"><ClipboardCheck className="size-4" /></span><div><p className="text-[10px] font-bold">Nota tersimpan.</p><p className="mt-1 text-[8px] text-slate-500">Mudah dicek kembali</p></div></div>
      <div className="absolute bottom-7 right-0 flex items-center gap-2.5 rounded-2xl bg-brand-950 p-3.5 text-white shadow-[0_8px_30px_-12px_rgba(0,0,0,.2)] sm:bottom-10 sm:p-4 lg:bottom-12"><span className="flex size-9 items-center justify-center rounded-xl bg-accent-500 text-brand-950"><ShieldCheck className="size-5" /></span><div><p className="text-[11px] font-semibold">Dirawat dengan perhatian.</p><p className="mt-1 text-[9px] text-white/65">Dari diterima sampai siap diambil</p></div></div>
      <span className="absolute right-7 top-10 flex size-10 rotate-12 items-center justify-center rounded-2xl bg-accent-500 text-brand-950 sm:top-14"><span className="text-2xl leading-none">✳</span></span>
    </div>
  );
}

function FeaturedProduct({ unit, phone }: { unit: PublicProduct; phone: string; }) {
  return (
    <article className="group flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-white">
      <div className="relative overflow-hidden bg-brand-100">
        {unit.photoUrl ? <img src={unit.photoUrl} alt={`${unit.brand} ${unit.model}`} loading="lazy" decoding="async" className="aspect-[5/4] w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" /> : unit.id ? <FirstPhoto refType="unit" refId={unit.id} className="aspect-[5/4] w-full rounded-none" /> : <div className="flex aspect-[5/4] items-center justify-center text-brand-300"><Smartphone className="size-12" strokeWidth={1} /></div>}
        {unit.garansiHari > 0 && <span className="absolute left-2.5 top-2.5 rounded-lg bg-white/95 px-2 py-1.5 text-[9px] font-semibold text-brand-800 sm:left-3 sm:top-3">Garansi {unit.garansiHari} hari</span>}
      </div>
      <div className="flex flex-1 flex-col p-3.5 sm:p-5">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-brand-600">{unit.brand}</p>
        <h3 className="mt-1.5 break-words text-sm font-semibold leading-snug tracking-tight sm:text-base">{unit.model}</h3>
        <p className="mt-1.5 break-words text-[11px] leading-5 text-slate-500">{[unit.varian, unit.kondisi].filter(Boolean).join(" · ")}</p>
        <p className="mb-4 mt-4 break-words text-sm font-bold tracking-tight text-brand-950 sm:text-lg">{rp(unit.hargaJual)}</p>
        {phone ? <a href={waLink(phone, `Halo, saya berminat dengan ${unit.brand} ${unit.model} ${unit.varian} (${unit.kode}) yang di katalog. Masih ada?`)} target="_blank" rel="noreferrer" className="mt-auto inline-flex min-h-11 items-center justify-between gap-1.5 rounded-xl bg-brand-50 px-3 text-[10px] font-semibold text-brand-800 transition-colors hover:bg-brand-100 sm:text-xs">Tanya unit ini <ArrowUpRight className="size-3.5 shrink-0" /></a> : <Link to="/katalog" className="mt-auto inline-flex min-h-11 items-center justify-between gap-1.5 rounded-xl bg-brand-50 px-3 text-[10px] font-semibold text-brand-800 hover:bg-brand-100 sm:text-xs">Lihat katalog <ArrowUpRight className="size-3.5 shrink-0" /></Link>}
      </div>
    </article>
  );
}
