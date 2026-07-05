interface StatusTextProps {
  message: string;
  busy: boolean;
}

export function StatusText({ message, busy }: StatusTextProps) {
  return <p className={`status-text${busy ? " is-busy" : ""}`} aria-live="polite">{message}</p>;
}
