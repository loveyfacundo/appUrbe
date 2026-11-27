export default function ToastViewport({ items, dismiss }) {
  return (
    <div className="toast-region" aria-live="polite">
      {items.map((item) => (
        <div
          className={`toast${item.kind === 'error' ? ' is-error' : ''}`}
          key={item.id}
          onClick={() => dismiss(item.id)}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
