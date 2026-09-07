"""
Dashboard de Rotacion Sectorial -- "Momento de Liquidez y Densidad de Capital".

Pestana nueva e independiente del dashboard principal (Next.js). Este modulo
es autocontenido: no toca ni depende de nada del resto del repo. Se corre
con:

    streamlit run capital-density-lab/app.py

Datos: yfinance (Yahoo Finance), gratis, sin API key.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

import analytics as an

st.set_page_config(
    page_title="Rotacion Sectorial - Densidad de Capital",
    page_icon="🧭",
    layout="wide",
)

# ─── Barra lateral ──────────────────────────────────────────────────────────

st.sidebar.title("🧭 Densidad de Capital")

window_label = st.sidebar.radio(
    "Ventana temporal",
    list(an.WINDOWS.keys()),
    index=0,
    help="Backtest = periodo cerrado para calibrar. Validacion = out-of-sample. "
    "Tiempo Real = datos live al momento de ejecutar el dashboard.",
)
window_start, window_end = an.WINDOWS[window_label]

st.sidebar.markdown("---")
st.sidebar.subheader("Parametros del modelo")

rolling_window = st.sidebar.slider(
    "Media movil / ventana de z-score (dias)", min_value=5, max_value=60, value=20, step=1
)
z_threshold = st.sidebar.slider(
    "Umbral de anomalia (Z-Score del ICD)", min_value=1.0, max_value=4.0, value=2.0, step=0.1
)

with st.sidebar.expander("Configuracion avanzada"):
    free_float_ratio = st.slider(
        "Proxy Free Float (% de shares outstanding)",
        min_value=0.5,
        max_value=1.0,
        value=an.DEFAULT_FREE_FLOAT_RATIO,
        step=0.01,
        help="Se usa solo cuando yfinance no expone floatShares directamente "
        "(caso habitual en ETFs).",
    )
    heatmap_days = st.slider("Dias mostrados en el mapa de rotacion", 10, 90, 30)
    lookback_days = st.slider("Estrategia: dias de lookback del delta ICD", 1, 10, 3)
    hold_days = st.slider("Estrategia: dias de tenencia", 1, 20, 5)

st.sidebar.markdown("---")
selected_ticker = st.sidebar.selectbox(
    "ETF para el grafico principal",
    an.SECTOR_ETFS,
    format_func=lambda t: f"{t} - {an.SECTOR_NAMES.get(t, t)}",
)

st.sidebar.caption(
    "Datos: Yahoo Finance via yfinance. market_cap y shares_outstanding de ETFs "
    "casi nunca vienen poblados por Yahoo -> se aproximan con AUM (totalAssets) "
    "y AUM/precio. Ver docstring de `fetch_ticker_static_info` en analytics.py."
)

# ─── Carga de datos (cacheada) ──────────────────────────────────────────────


@st.cache_data(ttl=3600, show_spinner="Descargando historial de precios (yfinance)...")
def load_price_histories(tickers: tuple[str, ...], start: str) -> dict[str, pd.DataFrame]:
    return an.download_price_history(list(tickers), pd.Timestamp(start))


@st.cache_data(ttl=3600, show_spinner="Consultando datos de capitalizacion / free float...")
def load_static_infos(tickers: tuple[str, ...], free_float_ratio: float) -> dict[str, an.TickerStaticInfo]:
    infos = {}
    for t in tickers:
        info = an.fetch_ticker_static_info(t, free_float_ratio=free_float_ratio)
        if info is not None:
            infos[t] = info
    return infos


all_tickers = tuple(an.SECTOR_ETFS + [an.BENCHMARK])

try:
    price_histories_full = load_price_histories(all_tickers, str(an.BACKTEST_START.date()))
except Exception as e:
    st.error(f"No se pudo descargar el historial de precios desde Yahoo Finance: {e}")
    st.stop()

missing_price = [t for t in all_tickers if t not in price_histories_full]
if missing_price:
    st.warning(f"Sin datos de precio para: {', '.join(missing_price)} (se excluyen del analisis).")

try:
    static_infos = load_static_infos(all_tickers, free_float_ratio)
except Exception as e:
    st.error(f"No se pudo consultar informacion de capitalizacion: {e}")
    st.stop()

missing_static = [t for t in an.SECTOR_ETFS if t not in static_infos]
if missing_static:
    st.warning(
        f"Sin AUM/precio suficiente para estimar shares outstanding de: "
        f"{', '.join(missing_static)} (se excluyen del ICD)."
    )

if not price_histories_full or not static_infos:
    st.error("No hay datos suficientes para operar el dashboard en este momento.")
    st.stop()

# ─── Metricas de densidad para TODO el historial, luego recorte por ventana ─

sector_price_histories_full = {t: price_histories_full[t] for t in an.SECTOR_ETFS if t in price_histories_full}
sector_metrics_full = an.compute_all_sectors_density(
    sector_price_histories_full, static_infos, rolling_window=rolling_window
)

sector_metrics_window = {
    t: an.slice_window(df, window_start, window_end) for t, df in sector_metrics_full.items()
}
sector_metrics_window = {t: df for t, df in sector_metrics_window.items() if not df.empty}

if not sector_metrics_window:
    st.warning(
        f"No hay datos para la ventana '{window_label}' todavia "
        "(puede ser normal si acaba de empezar el anio)."
    )
    st.stop()

# ─── Encabezado ──────────────────────────────────────────────────────────

st.title("Rotacion Sectorial de Capitales -- Momento de Liquidez y Densidad")
st.caption(
    f"Ventana activa: **{window_label}** "
    f"({window_start.date()} -> {window_end.date() if window_end else 'hoy'}) · "
    f"Media movil: {rolling_window}d · Umbral Z: {z_threshold}"
)

tab_grafico, tab_mapa, tab_ranking, tab_backtest = st.tabs(
    ["📈 Grafico Principal", "🔥 Mapa de Rotacion", "📊 Ranking de Sectores", "🧪 Backtesting Cuantitativo"]
)

# ─── Tab 1: grafico principal (OHLC + ICD) ─────────────────────────────────

with tab_grafico:
    df_sel = sector_metrics_window.get(selected_ticker)
    if df_sel is None or df_sel.empty:
        st.info(f"Sin datos de {selected_ticker} en esta ventana.")
    else:
        info_sel = static_infos.get(selected_ticker)
        if info_sel and info_sel.source == "proxy":
            st.caption(
                f"⚠️ Market cap / shares outstanding de {selected_ticker} estimados "
                "por proxy (AUM/precio) -- Yahoo no expone el dato directo para este ETF."
            )

        fig = make_subplots(specs=[[{"secondary_y": True}]])
        fig.add_trace(
            go.Candlestick(
                x=df_sel.index,
                open=df_sel["Open"],
                high=df_sel["High"],
                low=df_sel["Low"],
                close=df_sel["Close"],
                name=selected_ticker,
            ),
            secondary_y=False,
        )
        fig.add_trace(
            go.Scatter(
                x=df_sel.index,
                y=df_sel["ICD"],
                name="ICD",
                line=dict(color="#f97316", width=1.5),
            ),
            secondary_y=True,
        )
        fig.add_hline(y=z_threshold, line_dash="dot", line_color="#22c55e", secondary_y=True)
        fig.add_hline(y=-z_threshold, line_dash="dot", line_color="#ef4444", secondary_y=True)
        fig.update_layout(
            title=f"{selected_ticker} -- {an.SECTOR_NAMES.get(selected_ticker, '')}: Precio vs ICD",
            xaxis_rangeslider_visible=False,
            height=550,
            legend=dict(orientation="h", yanchor="bottom", y=1.02),
        )
        fig.update_yaxes(title_text="Precio (USD)", secondary_y=False)
        fig.update_yaxes(title_text="ICD (z-score compuesto)", secondary_y=True)
        st.plotly_chart(fig, width='stretch')

        col1, col2, col3 = st.columns(3)
        last = df_sel.dropna(subset=["ICD"]).iloc[-1] if not df_sel["ICD"].dropna().empty else None
        if last is not None:
            col1.metric("ICD actual", f"{last['ICD']:.2f}")
            col2.metric("ICD z-score", f"{last['ICD_zscore']:.2f}" if pd.notna(last["ICD_zscore"]) else "N/D")
            col3.metric("Volumen ultimo dia", f"{int(last['Volume']):,}")

# ─── Tab 2: mapa de rotacion (heatmap) ─────────────────────────────────────

with tab_mapa:
    matrix = an.build_rotation_matrix(sector_metrics_window, window_days=heatmap_days)
    if matrix.empty:
        st.info("Sin suficientes datos para construir el mapa de rotacion en esta ventana.")
    else:
        fig_hm = go.Figure(
            data=go.Heatmap(
                z=matrix.values,
                x=[d.strftime("%Y-%m-%d") for d in matrix.columns],
                y=matrix.index,
                colorscale="Inferno",
                colorbar=dict(title="ICD"),
            )
        )
        fig_hm.update_layout(
            title=f"Densidad de Capital por Sector -- ultimos {heatmap_days} dias de la ventana",
            height=550,
            xaxis=dict(tickangle=-60),
        )
        st.plotly_chart(fig_hm, width='stretch')
        st.caption(
            "Filas mas 'brillantes' (colores claros) = sectores absorbiendo mas capital "
            "relativo a su propio historial reciente. Seguir el brillo a lo largo del "
            "eje X muestra hacia donde rota el dinero."
        )

# ─── Tab 3: ranking de sectores ─────────────────────────────────────────────

with tab_ranking:
    ranking = an.latest_ranking(sector_metrics_window)
    if ranking.empty:
        st.info("Sin datos suficientes para el ranking en esta ventana.")
    else:
        st.dataframe(ranking, width='stretch', hide_index=True)
        top_sector = ranking.iloc[0]
        st.success(
            f"Mayor densidad de capital ahora mismo: **{top_sector['Sector']} ({top_sector['Ticker']})** "
            f"-- ICD {top_sector['ICD']}"
        )

# ─── Tab 4: backtesting cuantitativo ────────────────────────────────────────

with tab_backtest:
    st.subheader("Correlacion rezagada: ICD (t) vs retorno futuro")
    corr_matrix = an.lag_correlation_matrix(sector_metrics_window)
    if corr_matrix.empty:
        st.info("Sin suficientes observaciones para la matriz de correlacion en esta ventana.")
    else:
        fig_corr = go.Figure(
            data=go.Heatmap(
                z=corr_matrix.values,
                x=corr_matrix.columns,
                y=corr_matrix.index,
                colorscale="RdBu",
                zmid=0,
                colorbar=dict(title="Correlacion (r)"),
                text=np.round(corr_matrix.values, 2),
                texttemplate="%{text}",
            )
        )
        fig_corr.update_layout(
            title="Correlacion de Pearson: ICD z-score vs retorno futuro por horizonte",
            height=420,
        )
        st.plotly_chart(fig_corr, width='stretch')
        st.caption(
            "r > 0: picos de ICD tienden a preceder subidas de precio en ese horizonte. "
            "r < 0: tienden a preceder bajadas (posible senal de 'distribucion', no acumulacion)."
        )

    st.subheader(f"Estudio de eventos: ICD z-score > {z_threshold}")
    events = an.event_study(sector_metrics_window, z_threshold=z_threshold)
    if events.empty:
        st.info("Sin eventos de anomalia con el umbral actual en esta ventana.")
    else:
        st.dataframe(events, width='stretch', hide_index=True)
        st.caption(
            "Compara el retorno futuro promedio DESPUES de un evento de anomalia contra el "
            "retorno promedio incondicional del mismo sector. Si 'post-evento' supera "
            "consistentemente a 'base', el ICD tiene poder predictivo real en esta ventana."
        )

    st.markdown("---")
    st.subheader(
        f"Estrategia simulada: comprar mayor delta de ICD ({lookback_days}d) y mantener {hold_days}d"
    )
    strategy_curve = an.simulate_icd_rotation_strategy(
        sector_metrics_window, lookback_days=lookback_days, hold_days=hold_days
    )
    if strategy_curve.empty or len(strategy_curve) < 2:
        st.info("Sin suficientes rebalanceos para simular la estrategia en esta ventana.")
    else:
        spy_df = price_histories_full.get(an.BENCHMARK)
        benchmark_curve = pd.Series(dtype=float)
        if spy_df is not None:
            spy_window = an.slice_window(spy_df, window_start, window_end)
            if not spy_window.empty:
                benchmark_curve = an.buy_and_hold_curve(spy_window, strategy_curve.index)

        fig_strat = go.Figure()
        fig_strat.add_trace(
            go.Scatter(x=strategy_curve.index, y=strategy_curve.values, name="Estrategia ICD", line=dict(color="#f97316"))
        )
        if not benchmark_curve.empty:
            fig_strat.add_trace(
                go.Scatter(
                    x=benchmark_curve.index,
                    y=benchmark_curve.values,
                    name="Buy & Hold SPY",
                    line=dict(color="#64748b", dash="dash"),
                )
            )
        fig_strat.update_layout(
            title="Retorno acumulado: Estrategia de rotacion ICD vs Buy & Hold SPY",
            yaxis_title="Equity (base = 1.0)",
            height=450,
            legend=dict(orientation="h", yanchor="bottom", y=1.02),
        )
        st.plotly_chart(fig_strat, width='stretch')

        colA, colB, colC = st.columns(3)
        strat_total_return = strategy_curve.iloc[-1] / strategy_curve.iloc[0] - 1
        colA.metric("Retorno acumulado -- Estrategia", f"{strat_total_return * 100:.1f}%")
        if not benchmark_curve.empty:
            bench_total_return = benchmark_curve.iloc[-1] / benchmark_curve.iloc[0] - 1
            colB.metric("Retorno acumulado -- Buy & Hold SPY", f"{bench_total_return * 100:.1f}%")
            colC.metric("Diferencia (alpha simple)", f"{(strat_total_return - bench_total_return) * 100:.1f} pp")
        st.caption(f"Numero de rotaciones ejecutadas: {len(strategy_curve) - 1}")
