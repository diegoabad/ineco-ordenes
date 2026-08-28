import { useEffect, useState } from "react";
import {
  formatMoneyInputDisplay,
  formatMoneyInputWhileTyping,
  parseMoneyInput,
} from "../lib/moneyInput";

type Props = {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
};

export function MoneyInput({ id, label, value, onChange }: Props) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (focused) return;
    setText(formatMoneyInputDisplay(value));
  }, [value, focused]);

  return (
    <div className="form-group">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        className="fl-money-input"
        placeholder="0"
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          const parsed = parseMoneyInput(text);
          onChange(parsed);
          setText(formatMoneyInputDisplay(parsed));
        }}
        onChange={(e) => {
          const next = formatMoneyInputWhileTyping(e.target.value);
          setText(next);
          onChange(parseMoneyInput(next));
        }}
      />
    </div>
  );
}
