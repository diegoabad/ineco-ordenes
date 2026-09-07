type Props = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
};

/** Footer fijo del card (hermano de `.table-wrap`), siempre visible. */
export function TablePagination({
  page,
  pageSize,
  total,
  onPageChange,
  disabled = false,
}: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, total);

  return (
    <div className="table-pagination" role="navigation" aria-label="Paginación de la tabla">
      <div className="table-pagination__nav">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={disabled || safePage <= 1}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
        >
          Anterior
        </button>
        <span className="table-pagination__page">
          Página {safePage} de {totalPages}
        </span>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={disabled || safePage >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
        >
          Siguiente
        </button>
      </div>
      <span className="table-pagination__info">
        {from}–{to} de {total}
      </span>
    </div>
  );
}

export const TABLE_PAGE_SIZE = 20;
