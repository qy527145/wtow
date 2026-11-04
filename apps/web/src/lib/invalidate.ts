import { useQueryClient } from "@tanstack/react-query";

/** 作文写操作会同时影响两条管道的计数与列表，统一按前缀失效。 */
export function useInvalidatePipelines(slug: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["raw", slug] });
    qc.invalidateQueries({ queryKey: ["exec", slug] });
  };
}
