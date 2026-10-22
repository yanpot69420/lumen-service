import { RequireAuth, RequireOwner, SessionProvider } from "@/auth/session";
import { ErrorBoundary } from "@/components/error-boundary";
import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";





















const LandingPage = lazy(() => import("@/pages/public/landing").then((m) => ({ default: m.LandingPage })));
const KatalogPage = lazy(() => import("@/pages/public/katalog").then((m) => ({ default: m.KatalogPage })));
const CekStatusPage = lazy(() => import("@/pages/public/cek-status").then((m) => ({ default: m.CekStatusPage })));
const SetupPage = lazy(() => import("@/pages/auth/setup").then((m) => ({ default: m.SetupPage })));
const LoginPage = lazy(() => import("@/pages/auth/login").then((m) => ({ default: m.LoginPage })));
const CloudBoot = lazy(() => import("@/pages/auth/cloud-boot").then((m) => ({ default: m.CloudBoot })));
const BerandaPage = lazy(() => import("@/pages/beranda").then((m) => ({ default: m.BerandaPage })));
const ServisListPage = lazy(() => import("@/pages/servis/list").then((m) => ({ default: m.ServisListPage })));
const ServisBaruPage = lazy(() => import("@/pages/servis/baru").then((m) => ({ default: m.ServisBaruPage })));
const ServisDetailPage = lazy(() => import("@/pages/servis/detail").then((m) => ({ default: m.ServisDetailPage })));
const NotaPrintPage = lazy(() => import("@/pages/servis/nota").then((m) => ({ default: m.NotaPrintPage })));
const StokPage = lazy(() => import("@/pages/stok/list").then((m) => ({ default: m.StokPage })));
const BeliUnitPage = lazy(() => import("@/pages/stok/beli").then((m) => ({ default: m.BeliUnitPage })));
const UnitDetailPage = lazy(() => import("@/pages/stok/unit-detail").then((m) => ({ default: m.UnitDetailPage })));
const KasPage = lazy(() => import("@/pages/kas/kas").then((m) => ({ default: m.KasPage })));
const LaporanPage = lazy(() => import("@/pages/laporan").then((m) => ({ default: m.LaporanPage })));
const KoreksiPage = lazy(() => import("@/pages/koreksi").then((m) => ({ default: m.KoreksiPage })));
const AuditPage = lazy(() => import("@/pages/audit").then((m) => ({ default: m.AuditPage })));
const PengaturanPage = lazy(() => import("@/pages/pengaturan").then((m) => ({ default: m.PengaturanPage })));
const MenuPage = lazy(() => import("@/pages/menu").then((m) => ({ default: m.MenuPage })));
const SinkronisasiPage = lazy(() => import("@/pages/sinkronisasi").then((m) => ({ default: m.SinkronisasiPage })));
const PelangganListPage = lazy(() => import("@/pages/pelanggan/list").then((m) => ({ default: m.PelangganListPage })));
const PelangganDetailPage = lazy(() => import("@/pages/pelanggan/detail").then((m) => ({ default: m.PelangganDetailPage })));

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <SessionProvider>
          <BrowserRouter>
            <Suspense fallback={<div role="status" className="p-8 text-center text-sm text-slate-500">Memuat halaman…</div>}>
              <Routes>
                {/* Publik */}
                <Route path="/" element={<LandingPage />} />
                <Route path="/katalog" element={<KatalogPage />} />
                <Route path="/cek" element={<CekStatusPage />} />

                {/* Semua rute internal lewat gerbang boot cloud (cek status toko). */}
                <Route element={<CloudBoot />}>
                  {/* Auth */}
                  <Route path="/app/setup" element={<SetupPage />} />
                  <Route path="/app/login" element={<LoginPage />} />

                  {/* Internal */}
                  <Route
                    path="/app"
                    element={
                      <RequireAuth>
                        <AppShell />
                      </RequireAuth>
                    }
                  >
                    <Route index element={<Navigate to="/app/beranda" replace />} />
                    <Route path="beranda" element={<BerandaPage />} />
                    <Route path="servis" element={<ServisListPage />} />
                    <Route path="servis/baru" element={<ServisBaruPage />} />
                    <Route path="servis/:id" element={<ServisDetailPage />} />
                    <Route path="pelanggan" element={<PelangganListPage />} />
                    <Route path="pelanggan/:id" element={<PelangganDetailPage />} />
                    <Route path="stok" element={<StokPage />} />
                    <Route path="stok/beli" element={<BeliUnitPage />} />
                    <Route path="stok/unit/:id" element={<UnitDetailPage />} />
                    <Route path="kas" element={<KasPage />} />
                    <Route path="laporan" element={<LaporanPage />} />
                    <Route path="koreksi" element={<KoreksiPage />} />
                    <Route
                      path="audit"
                      element={
                        <RequireOwner>
                          <AuditPage />
                        </RequireOwner>
                      }
                    />
                    <Route path="pengaturan" element={<PengaturanPage />} />
                    <Route path="menu" element={<MenuPage />} />
                    <Route path="sinkronisasi" element={<SinkronisasiPage />} />
                  </Route>

                  {/* Nota print (tanpa shell agar bersih saat dicetak) */}
                  <Route
                    path="/app/nota/:type/:id"
                    element={
                      <RequireAuth>
                        <NotaPrintPage />
                      </RequireAuth>
                    }
                  />
                </Route>

                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </Suspense>
          </BrowserRouter>
        </SessionProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
