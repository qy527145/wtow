import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { api } from "../api/client";
import type { Member } from "../api/types";

/** 看板轮询间隔，见 DESIGN 10.2。 */
export const POLL_MS = 10_000;

export function useSlug(): string {
  return useParams().slug!;
}

export function useProject(slug: string) {
  return useQuery({ queryKey: ["project", slug], queryFn: () => api.project(slug) });
}

export function useMembers(slug: string) {
  return useQuery({
    queryKey: ["members", slug],
    queryFn: () => api.members(slug),
    staleTime: 60_000,
  });
}

/** user_id → 显示名，用于把作文里的 reporter_id / developer_id 渲染成人名。 */
export function useMemberNames(slug: string): (id: number | null | undefined) => string {
  const { data } = useMembers(slug);
  const map = new Map<number, Member>((data ?? []).map((m) => [m.user_id, m]));
  return (id) => {
    if (id === null || id === undefined) return "—";
    const m = map.get(id);
    return m ? m.display_name || m.email : `#${id}`;
  };
}
