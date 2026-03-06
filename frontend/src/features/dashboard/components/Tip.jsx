export function Tip({ text }) {
  return (
    <span className="tip" title={text} aria-label={text}>
      ?
    </span>
  );
}
