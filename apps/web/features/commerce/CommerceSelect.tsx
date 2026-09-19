import { Select } from "antd";
import { Children, isValidElement, type ReactNode } from "react";

/** Ant Design selection with the same glass surface as the workspace controls. */
export function CommerceSelect({
  children,
  value,
  onChange,
  disabled,
  "aria-label": label,
}: {
  children: ReactNode;
  value: string | number;
  onChange: (value: string) => void;
  disabled?: boolean;
  "aria-label": string;
}) {
  const options = Children.toArray(children).flatMap((child) => {
    if (
      !isValidElement<{ value?: string | number; children?: ReactNode }>(child)
    )
      return [];
    const text = Children.toArray(child.props.children).join("");
    return [{ label: text, value: String(child.props.value ?? text) }];
  });
  return (
    <Select
      aria-label={label}
      className="commerce-select"
      disabled={disabled}
      options={options}
      value={String(value)}
      onChange={onChange}
      popupMatchSelectWidth
      styles={{ popup: { root: { borderRadius: 14, padding: 6 } } }}
    />
  );
}
