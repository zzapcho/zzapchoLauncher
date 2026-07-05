interface PlayButtonProps {
  busy: boolean;
  onClick: () => void;
}

export function PlayButton({ busy, onClick }: PlayButtonProps) {
  return (
    <button className="play-button" type="button" onClick={onClick} disabled={busy} aria-label="선택한 프로필 실행">
      <span className="play-icon" aria-hidden="true" />
      <span>{busy ? "CHECKING" : "PLAY"}</span>
    </button>
  );
}
