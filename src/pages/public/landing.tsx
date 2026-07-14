import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Wrench,
  Smartphone,
  ShieldCheck,
  Search,
  MessageCircle,
  MapPin,
  Clock,
} from "lucide-react";
import { db } from "@/db/db";
import { getSetting } from "@/db/settings";
import { waLink } from "@/lib/wa";
import { rp } from "@/lib/format";
import { FirstPhoto } from "@/components/photos";

export function useStoreProfile() {
  const [s, setS] = useState({
    name: "Lumen Service",
    tagline: "",
    address: "",
    phone: "",
    hours: "",
  });
  useEffect(() => {
    (async () => {
      setS({
        name: await getSetting("storeName"),
        tagline: await getSetting("storeTagline"),
        address: await getSetting("storeAddress"),
        phone: await getSetting("storePhone"),
        hours: await getSetting("storeHours"),
      });
    })();
  }, []);
  return s;
}

export function PublicNav({ active }: { active: "home" | "katalog" | "cek" }) {
  const links = [
    ["home", "/", "Beranda"],
    ["katalog", "/katalog", "Katalog HP"],
    ["cek", "/cek", "Cek Servis"],
  ] as const;
  return (
    <nav className="sticky top-0 z-30 border-b border-white/10 bg-brand-950/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-4xl items-center gap-4 px-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent-500 text-sm font-black text-brand-950">
            L
          </span>
          <span className="text-sm font-bold text-white">Lumen Service</span>
        </Link>
        <div className="ml-auto flex items-center gap-1 text-sm">
          {links.map(([k, to, label]) => (
            <Link
              key={k}
              to={to}
              className={
                active === k
                  ? "rounded-lg bg-white/10 px-3 py-1.5 font-semibold text-white"
                  : "rounded-lg px-3 py-1.5 text-slate-300 hover:text-white"
              }
            >
              {label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-white/10 bg-brand-950 py-6 text-center text-xs text-slate-400">
      © {new Date().getFullYear()} Lumen Service
    </footer>
  );
}

export function LandingPage() {
  const store = useStoreProfile();
  const featured = useLiveQuery(
    () =>
      db.units
        .where("status")
        .equals("stok")
        .filter((u) => u.hargaJual > 0)
        .limit(4)
        .toArray(),
    [],
  );

  const layanan = [
    {
      icon: Wrench,
      title: "Servis Semua Merk",
      desc: "LCD, baterai, mati total, software — dikerjakan teknisi berpengalaman dengan sparepart berkualitas.",
    },
    {
      icon: Smartphone,
      title: "Jual Beli HP Second",
      desc: "HP second berkualitas, IMEI aman, dicek menyeluruh. Mau jual HP? Harga penawaran wajar.",
    },
    {
      icon: ShieldCheck,
      title: "Bergaransi & Transparan",
      desc: "Servis bergaransi, unit second bergaransi toko. Nota digital + foto kondisi sebelum dikerjakan.",
    },
  ];

  return (
    <div className="min-h-dvh bg-brand-950">
      <PublicNav active="home" />

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-4 pb-16 pt-14 text-center">
        <h1 className="text-3xl font-black leading-tight text-white sm:text-5xl">
          HP Bermasalah?
          <br />
          <span className="text-accent-500">Serahkan ke Lumen.</span>
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-sm text-slate-300 sm:text-base">
          {store.tagline || "Servis HP semua merk & jual beli HP second terpercaya."}{" "}
          Cek status servis Anda kapan saja tanpa perlu telepon.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          {store.phone && (
            <a
              href={waLink(store.phone, "Halo Lumen Service, saya mau tanya…")}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent-500 px-6 font-semibold text-brand-950 hover:bg-accent-400"
            >
              <MessageCircle className="size-5" /> Chat WhatsApp
            </a>
          )}
          <Link
            to="/cek"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/20 px-6 font-semibold text-white hover:bg-white/5"
          >
            <Search className="size-5" /> Cek Status Servis
          </Link>
        </div>
      </section>

      {/* Layanan */}
      <section className="bg-slate-50 py-14">
        <div className="mx-auto grid max-w-4xl gap-4 px-4 sm:grid-cols-3">
          {layanan.map((l) => (
            <div key={l.title} className="rounded-2xl border border-slate-200 bg-white p-6">
              <l.icon className="size-8 text-brand-600" />
              <h3 className="mt-3 font-bold">{l.title}</h3>
              <p className="mt-1 text-sm text-slate-500">{l.desc}</p>
            </div>
          ))}
        </div>

        {/* Katalog highlight */}
        {(featured?.length ?? 0) > 0 && (
          <div className="mx-auto mt-12 max-w-4xl px-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-bold">HP Second Siap Pakai</h2>
              <Link to="/katalog" className="text-sm font-medium text-brand-600">
                Lihat semua →
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {featured?.map((u) => (
                <div key={u.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <FirstPhoto refType="unit" refId={u.id} className="aspect-square w-full rounded-none" />
                  <div className="p-3">
                    <p className="truncate text-sm font-semibold">
                      {u.brand} {u.model}
                    </p>
                    <p className="text-xs text-slate-400">{u.varian}</p>
                    <p className="mt-1 text-sm font-bold text-brand-600">{rp(u.hargaJual)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info toko */}
        <div className="mx-auto mt-12 max-w-4xl px-4">
          <div className="grid gap-4 rounded-2xl bg-brand-950 p-6 text-white sm:grid-cols-2">
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 size-5 shrink-0 text-accent-500" />
              <div>
                <p className="text-sm font-semibold">Alamat</p>
                <p className="text-sm text-slate-300">
                  {store.address || "Alamat konter — atur di Pengaturan"}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 size-5 shrink-0 text-accent-500" />
              <div>
                <p className="text-sm font-semibold">Jam Buka</p>
                <p className="text-sm text-slate-300">{store.hours}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}
