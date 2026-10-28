import { Children, isValidElement, type ReactNode } from "react";
import { GlideSelect } from "@/features/controls/GlideSelect";

/** One shared accessible selector; commerce owns its values and dispatch. */
export function CommerceSelect({ children, value, onChange, disabled, "aria-label": label }: {
  children: ReactNode; value: string | number; onChange: (value: string) => void;
  disabled?: boolean; "aria-label": string;
}) {
  const options = Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    const text = Children.toArray(child.props.children).join("");
    return [{ label: text, textValue: text, value: String(child.props.value ?? text), disabled: child.props.disabled }];
  });
  return <GlideSelect ariaLabel={label} className="commerce-select" disabled={disabled}
    options={options} value={String(value)} onChange={onChange}/>;
}
