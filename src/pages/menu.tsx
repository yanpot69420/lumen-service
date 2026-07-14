import { Link, useNavigate } from "react-router-dom";
import {
  BarChart3,
  ClipboardCheck,
  ScrollText,
  Settings,
  Globe,
  LogOut,
  ChevronRight,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/db";
import { useSession, useUser } from "@/auth/session";
import { canSeeMoney } from "@/auth/roles";
import { ROLE_LABEL, PageBody, PageHeader } from "@/components/layout/app-shell";

export function MenuPage() {
  const user = useUser();
  const { logout } = useSession();
  const nav = useNavigate();
  const pending = useLiveQuery(
    () => db.corrections.where("status").equals("pending").count(),
    [],
  );

  const items = [
    ...(canSeeMoney(user.role)
      ? [{ to: "/app/laporan", label: "Laporan", icon: BarChart3 }]
      : []),
    {
      to: "/app/koreksi",
      label: "Jurnal Koreksi",
      icon: ClipboardCheck,
      badge: pending,
    },
    ...(user.role === "owner"
      ? [{ to: "/app/audit", label: "Audit Log", icon: ScrollText }]
      : []),
    { to: "/app/pengaturan", label: "Pengaturan", icon: Settings },
    { to: "/", label: "Web Publik", icon: Globe },
  ];

  return (
    <>
      <PageHeader title="Lainnya" />
      <PageBody>
        <div className="flex items-center gap-3 rounded-2xl bg-brand-950 p-4 text-white">
          <div className="flex size-11 items-center justify-center rounded-full bg-brand-700 text-base font-bold">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <p className="text-sm font-bold">{user.name}</p>
            <p className="text-xs text-slate-300">{ROLE_LABEL[user.role]}</p>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {items.map(({ to, label, icon: Icon, badge }) => (
            <Link
              key={to}
              to={to}
              className="flex items-center gap-3 border-b border-slate-100 p-4 text-sm font-medium last:border-0 hover:bg-slate-50"
            >
              <Icon className="size-4.5 text-slate-400" />
              {label}
              {!!badge && (
                <span className="rounded-full bg-accent-500 px-2 text-xs font-bold text-brand-950">
                  {badge}
                </span>
              )}
              <ChevronRight className="ml-auto size-4 text-slate-300" />
            </Link>
          ))}
        </div>
        <button
          onClick={() => {
            logout();
            nav("/app/login");
          }}
          className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          <LogOut className="size-4.5" />
          Keluar
        </button>
      </PageBody>
    </>
  );
}
