import { describe, expect, test } from "bun:test";

import { cn } from "@wtow/ui/lib/utils";

describe("cn", () => {
  test("合并条件类名", () => {
    expect(cn("p-2", false && "hidden", "text-sm")).toBe("p-2 text-sm");
  });

  test("后者覆盖冲突的 Tailwind 类", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
