import { useRef, type KeyboardEvent, type ClipboardEvent } from "react";

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function OTPInput({ length = 6, value, onChange, disabled }: OTPInputProps) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = value.padEnd(length, "").split("").slice(0, length);

  const focusInput = (index: number) => {
    inputRefs.current[index]?.focus();
  };

  const handleChange = (index: number, char: string) => {
    if (!/^\d?$/.test(char)) return;
    const newDigits = [...digits];
    newDigits[index] = char;
    onChange(newDigits.join(""));
    if (char && index < length - 1) focusInput(index + 1);
  };

  const handleKeyDown = (index: number, e: KeyboardEvent) => {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      focusInput(index - 1);
    }
  };

  const handlePaste = (e: ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    if (pasted) {
      onChange(pasted.padEnd(length, "").slice(0, length));
      focusInput(Math.min(pasted.length, length - 1));
    }
  };

  return (
    <div style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => { inputRefs.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          disabled={disabled}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={i === 0 ? handlePaste : undefined}
          style={{
            width: "44px",
            height: "48px",
            textAlign: "center",
            fontSize: "20px",
            fontWeight: 600,
            borderRadius: "8px",
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: "#0f172a",
            outline: "none",
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? "not-allowed" : "text",
          }}
        />
      ))}
    </div>
  );
}
