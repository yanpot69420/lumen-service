import { Component, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Menahan error render agar tidak jadi layar putih tanpa penjelasan. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[lumen] render error:", error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 p-6 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-red-100 text-2xl">
          ⚠️
        </div>
        <div>
          <h1 className="text-lg font-bold">Terjadi kesalahan</h1>
          <p className="mt-1 max-w-sm text-sm text-slate-500">
            Data Anda aman di perangkat. Muat ulang aplikasi untuk melanjutkan —
            bila terulang di halaman yang sama, laporkan pesan di bawah ini.
          </p>
        </div>
        <code className="max-w-full overflow-x-auto rounded-xl bg-slate-100 px-3 py-2 text-xs text-red-700">
          {this.state.error.message}
        </code>
        <button
          onClick={() => location.reload()}
          className="h-11 rounded-xl bg-brand-950 px-6 text-sm font-medium text-white hover:bg-brand-900"
        >
          Muat Ulang Aplikasi
        </button>
      </div>
    );
  }
}
