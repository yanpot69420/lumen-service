import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { SessionProvider, RequireAuth, RequireOwner } from "@/auth/session";
import { ErrorBoundary } from "@/components/error-boundary";
import { ToastProvider } from "@/components/ui/toast";
import { AppShell } from "@/components/layout/app-shell";
import { LandingPage } from "@/pages/public/landing";
import { KatalogPage } from "@/pages/public/katalog";
import { CekStatusPage } from "@/pages/public/cek-status";
import { SetupPage } from "@/pages/auth/setup";
import { LoginPage } from "@/pages/auth/login";
import { CloudBoot } from "@/pages/auth/cloud-boot";
import { BerandaPage } from "@/pages/beranda";
import { ServisListPage } from "@/pages/servis/list";
import { ServisBaruPage } from "@/pages/servis/baru";
import { ServisDetailPage } from "@/pages/servis/detail";
import { NotaPrintPage } from "@/pages/servis/nota";
import { StokPage } from "@/pages/stok/list";
import { BeliUnitPage } from "@/pages/stok/beli";
import { UnitDetailPage } from "@/pages/stok/unit-detail";
import { KasPage } from "@/pages/kas/kas";
import { LaporanPage } from "@/pages/laporan";
import { KoreksiPage } from "@/pages/koreksi";
import { AuditPage } from "@/pages/audit";
import { PengaturanPage } from "@/pages/pengaturan";
import { MenuPage } from "@/pages/menu";

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
      <SessionProvider>
        <BrowserRouter>
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
        </BrowserRouter>
      </SessionProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
