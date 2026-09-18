// shadcn/ui registry component, styled with Relay semantic tokens. See docs/COMPONENTS.md.
import * as React from "react";
import { cn } from "../../lib/utils.js";

function Alert({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="alert" role="alert" className={cn("notice", className)} {...props} />;
}

export { Alert };
