import { useEffect, useMemo, useState } from "react";
import { TABLE_PAGE_SIZE } from "../components/TablePagination";

/** Pagina en cliente y vuelve a página 1 cuando cambian los filtros (`resetKey`). */
export function useClientPagination<T>(
  items: T[],
  resetKey: string | number,
  pageSize: number = TABLE_PAGE_SIZE,
) {
  const [page, setPage] = useState(1);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  useEffect(() => {
    setPage(1);
  }, [resetKey]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (Math.min(page, totalPages) - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, page, pageSize, totalPages]);

  return {
    page: Math.min(page, totalPages),
    setPage,
    pageItems,
    total,
    pageSize,
    totalPages,
  };
}
