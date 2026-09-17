export default function PromptBar({ text }: { text: string }) {
  return (
    <div className="prompt-bar">
      <span className="prompt-bar-text">{text}</span>
    </div>
  )
}
