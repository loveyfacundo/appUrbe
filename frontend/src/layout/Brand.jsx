export default function Brand({ light = false }) {
  return (
    <a className={`brand${light ? ' brand-light' : ''}`} href="/" aria-label="AppUrbe inicio">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 36 36">
          <path d="M7 25.5 18 7l11 18.5H7Z" />
          <path d="M13 25.5 18 17l5 8.5" />
        </svg>
      </span>
      <span>app<span className="brand-strong">urbe</span></span>
    </a>
  );
}
