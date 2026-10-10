import { Children, Fragment, type ReactNode } from "react";
import { View } from "react-native";

/** The web's `divide-y divide-border`: a hairline between neighbouring children. */
export function Divided({ children }: { children: ReactNode }) {
  return (
    <>
      {Children.toArray(children).map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <View className="h-px bg-border" />}
          {child}
        </Fragment>
      ))}
    </>
  );
}
