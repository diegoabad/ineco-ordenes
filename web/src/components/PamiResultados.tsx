import { Fragment, useMemo, useState } from "react";
import { withDuplicadosDebitos, type ResultadoPami } from "../lib/pami";
import { IconAlert } from "./Icons";

type Props = {
  result: ResultadoPami;
  compact?: boolean;
};

export function PamiResultados({ result: resultProp, compact }: Props) {
  const result = useMemo(() => withDuplicadosDebitos(resultProp), [resultProp]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const max125 = useMemo(
    () => Math.max(1, ...result.concentracion125.map((r) => r.cantidad)),
    [result.concentracion125],
  );

  const { resumen } = result;
  const prest125 = resumen.prestacionesPorCodigo["125"] ?? 0;
  const prest140 = resumen.prestacionesPorCodigo["140"] ?? 0;
  const mod125 = resumen.opsPorModulo["125001"] ?? 0;
  const mod140 = resumen.opsPorModulo["140010"] ?? 0;
  const r125 = resumen.concentracion125;

  return (
    <div className={`pami-resultados${compact ? " pami-resultados--compact" : ""}`}>
      <div className="pami-cards">
        <article className="pami-card">
          <p className="pami-card__value">{resumen.afiliadosCoincidentes}</p>
          <p className="pami-card__title">Afiliados coincidentes</p>
          <p className="pami-card__hint">
            Están en los dos archivos: se les presentó OP y además tienen prestaciones observadas.
          </p>
          <p className="pami-card__breakdown">
            Solo presentación: {resumen.soloEnPresentacion} · Solo débitos: {resumen.soloEnDebitos}
          </p>
        </article>
        <article className="pami-card">
          <p className="pami-card__value">{resumen.prestacionesObservadas}</p>
          <p className="pami-card__title">Prestaciones observadas</p>
          <p className="pami-card__hint">Total de filas del archivo Débitos (PAMI).</p>
          <p className="pami-card__breakdown">
            125: {prest125} · 140: {prest140}
          </p>
        </article>
        <article className="pami-card">
          <p className="pami-card__value">{resumen.opsPresentadas}</p>
          <p className="pami-card__title">OPs presentadas</p>
          <p className="pami-card__hint">Total de filas válidas del archivo Presentación (INECO).</p>
          <p className="pami-card__breakdown">
            125001: {mod125} · 140010: {mod140}
          </p>
        </article>
        <article className="pami-card">
          <p className="pami-card__value">{resumen.afiliadosObservados}</p>
          <p className="pami-card__title">Afiliados únicos observados</p>
          <p className="pami-card__hint">
            Cuántas personas distintas concentran esas prestaciones observadas.
          </p>
        </article>
      </div>

      {result.alertas.length > 0 && (
        <ul className="pami-alertas">
          {result.alertas.map((a) => (
            <li key={`${a.tipo}-${a.mensaje}`} className="pami-alerta">
              <div className="pami-alerta__accent" aria-hidden />
              <div className="pami-alerta__icon" aria-hidden>
                <IconAlert size={16} />
              </div>
              <div className="pami-alerta__body">
                <div className="pami-alerta__head">
                  <p className="pami-alerta__title">{a.titulo ?? "Alerta"}</p>
                  {a.badge ? <span className="pami-alerta__badge">{a.badge}</span> : null}
                </div>
                {a.meta ? <p className="pami-alerta__meta">{a.meta}</p> : null}
                {!a.titulo && !a.meta ? (
                  <p className="pami-alerta__fallback">{a.mensaje}</p>
                ) : null}
                {a.items && a.items.length > 0 ? (
                  <ul className="pami-alerta__items">
                    {a.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {(result.duplicadosDebitos?.length ?? 0) > 0 && (
        <section className="fl-table-card pami-section">
          <div className="table-toolbar">
            <h2 className="pami-section__title">Prestaciones duplicadas en Débitos</h2>
          </div>
          <p className="pami-section__context">
            Mismo afiliado, fecha y código en más de una fila. No se deduplican: se listan todos
            los motivos de rechazo.
          </p>
          <div className="table-wrap">
            <table className="pami-table pami-table--duplicados">
              <thead>
                <tr>
                  <th className="pami-col-afiliado">Afiliado</th>
                  <th className="pami-col-fecha">Fecha</th>
                  <th className="pami-col-codigo">Código</th>
                  <th className="pami-col-cant">Filas</th>
                  <th className="pami-col-motivos">Motivos de rechazo</th>
                </tr>
              </thead>
              <tbody>
                {result.duplicadosDebitos.map((d) => (
                  <tr key={`${d.afiliadoNormalizado}-${d.fecha}-${d.codigo}`}>
                    <td className="pami-mono pami-col-afiliado">{d.afiliadoOriginal}</td>
                    <td className="pami-col-fecha">{d.fecha}</td>
                    <td className="pami-col-codigo">{d.codigo}</td>
                    <td className="pami-col-cant">{d.cantidadFilas}</td>
                    <td className="pami-col-motivos">
                      <ul className="pami-motivos-list">
                        {d.motivos.map((m) => (
                          <li key={m}>{m}</li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="fl-table-card pami-section">
        <div className="table-toolbar">
          <h2 className="pami-section__title">Coincidencias</h2>
        </div>
        {result.coincidencias.length === 0 ? (
          <div className="fl-table-empty">
            <p className="fl-table-empty__title">0 afiliados en común entre los dos archivos</p>
            <p className="fl-table-empty__hint">
              Es un resultado válido: no hay afiliados a revisar por cruce este mes.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="pami-table pami-table--coincidencias">
              <thead>
                <tr>
                  <th className="pami-col-expand" aria-label="Detalle" />
                  <th className="pami-col-afiliado">Afiliado</th>
                  <th className="pami-col-nombre">Nombre</th>
                  <th className="pami-col-op">Módulo / OP</th>
                  <th className="pami-col-obs">Observadas</th>
                  <th className="pami-col-codigos">Códigos</th>
                </tr>
              </thead>
              <tbody>
                {result.coincidencias.map((c) => {
                  const open = expanded === c.afiliadoNormalizado;
                  return (
                    <Fragment key={c.afiliadoNormalizado}>
                      <tr className={c.codigoDistintoAlModulo ? "pami-row--warn" : undefined}>
                        <td className="pami-col-expand">
                          <button
                            type="button"
                            className="btn btn-outline btn-sm pami-expand-btn"
                            aria-expanded={open}
                            onClick={() =>
                              setExpanded(open ? null : c.afiliadoNormalizado)
                            }
                          >
                            {open ? "−" : "+"}
                          </button>
                        </td>
                        <td className="pami-mono pami-col-afiliado">{c.afiliadoOriginal}</td>
                        <td className="pami-col-nombre">
                          {c.nombre}
                          {c.codigoDistintoAlModulo && (
                            <span className="pami-flag" title="Código observado distinto al módulo presentado">
                              {" "}
                              código ≠ módulo
                            </span>
                          )}
                        </td>
                        <td className="pami-col-op">
                          {c.presentacion.map((p) => (
                            <div key={`${p.numeroOp}-${p.modulo}`}>
                              {p.modulo} · OP {p.numeroOp}
                            </div>
                          ))}
                        </td>
                        <td className="pami-col-obs">{c.cantidadObservadas}</td>
                        <td className="pami-col-codigos">{c.codigosObservados.join(", ")}</td>
                      </tr>
                      {open && (
                        <tr className="pami-detail-row">
                          <td colSpan={6}>
                            <div className="table-wrap">
                              <table className="pami-table pami-table--detalle">
                                <thead>
                                  <tr>
                                    <th className="pami-col-fecha">Fecha</th>
                                    <th className="pami-col-codigo">Código</th>
                                    <th className="pami-col-tipo">Tipo</th>
                                    <th className="pami-col-motivo">Motivo de rechazo</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {c.detalle.map((d, i) => (
                                    <tr
                                      key={`${c.afiliadoNormalizado}-d-${i}`}
                                      className={d.esDuplicado ? "pami-row--dup" : undefined}
                                    >
                                      <td className="pami-col-fecha">{d.fecha}</td>
                                      <td className="pami-col-codigo">{d.codigo}</td>
                                      <td className="pami-col-tipo">{d.tipo}</td>
                                      <td className="pami-col-motivo">
                                        {d.motivo}
                                        {d.esDuplicado ? (
                                          <span className="pami-flag"> duplicado</span>
                                        ) : null}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="fl-table-card pami-section">
        <div className="table-toolbar">
          <h2 className="pami-section__title">Concentración de prestación 125</h2>
        </div>
        <p className="pami-section__context">
          {r125.afiliadosUnicos} afiliados concentran {r125.totalPrestaciones} prestaciones
          observadas; {r125.conMasDeUna} de ellos tienen más de una · {r125.conUnaSola} con una
          sola.
        </p>
        <div className="table-wrap">
          <table className="pami-table pami-table--concentracion">
            <thead>
              <tr>
                <th className="pami-col-afiliado">Afiliado</th>
                <th className="pami-col-cant">Cant.</th>
                <th className="pami-col-pct">%</th>
                <th className="pami-col-barra">Concentración</th>
                <th className="pami-col-en-pres">En presentación</th>
              </tr>
            </thead>
            <tbody>
              {result.concentracion125.map((row) => (
                <tr
                  key={row.afiliadoNormalizado}
                  className={row.estaEnPresentacion ? "pami-row--highlight" : undefined}
                >
                  <td className="pami-mono pami-col-afiliado">{row.afiliadoOriginal}</td>
                  <td className="pami-col-cant">{row.cantidad}</td>
                  <td className="pami-col-pct">{row.porcentajeDelTotal.toFixed(1)}%</td>
                  <td className="pami-col-barra">
                    <div className="pami-bar">
                      <div
                        className="pami-bar__fill"
                        style={{ width: `${(row.cantidad / max125) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="pami-col-en-pres">
                    {row.estaEnPresentacion ? (
                      <span className="pami-si-badge" title="Está en presentación">
                        Sí
                      </span>
                    ) : (
                      <span className="pami-no-label">No</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fl-table-card pami-section">
        <div className="table-toolbar">
          <h2 className="pami-section__title">Motivos de rechazo</h2>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Motivo</th>
                <th style={{ width: "5rem" }}>Cant.</th>
                <th style={{ width: "6rem" }}>%</th>
              </tr>
            </thead>
            <tbody>
              {result.motivos.map((m) => (
                <tr key={m.motivo}>
                  <td>{m.motivo}</td>
                  <td>{m.cantidad}</td>
                  <td>{m.porcentaje.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
