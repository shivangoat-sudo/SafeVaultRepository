import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean; message: string };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" };

  static getDerivedStateFromError(err: unknown): State {
    const message = err instanceof Error ? err.message : String(err);
    return { hasError: true, message };
  }

  componentDidCatch(err: unknown) {
    console.error("ErrorBoundary caught:", err);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center px-4">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-error-50 text-error-600 mb-4">
            !
          </span>
          <p className="text-sm font-medium text-ink-800">Er ging iets mis bij het weergeven.</p>
          <p className="mt-2 text-xs text-ink-400 max-w-md break-words font-mono">{this.state.message}</p>
          <button
            onClick={() => this.setState({ hasError: false, message: "" })}
            className="btn-secondary mt-4"
          >
            Opnieuw proberen
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
