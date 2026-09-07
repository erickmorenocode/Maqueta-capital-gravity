"""
Motor cuantitativo del laboratorio de Rotacion Sectorial.

Indicador propio: "Momento de Liquidez y Densidad de Capital" (ICD).
No depende de Streamlit -- todo lo de aqui es testeable/reutilizable
desde cualquier script o notebook.

Fuente de datos: yfinance (Yahoo Finance), sin costo, sin API key.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import yfinance as yf

# ─── Universo de instrumentos ──────────────────────────────────────────────

SECTOR_ETFS: list[str] = [
    "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLRE", "XLU", "XLC",
]

BENCHMARK = "SPY"

SECTOR_NAMES: dict[str, str] = {
    "XLK": "Tecnologia",
    "XLF": "Financiero",
    "XLE": "Energia",
    "XLV": "Salud",
    "XLY": "Consumo Discrecional",
    "XLP": "Consumo Basico",
    "XLI": "Industrial",
    "XLB": "Materiales",
    "XLRE": "Bienes Raices",
    "XLU": "Servicios Publicos",
    "XLC": "Comunicaciones",
}

# Proxy configurable de Free Float cuando yfinance no expone floatShares
# (caso habitual en ETFs). 0.95 = se asume que el 95% de las acciones en
# circulacion estan efectivamente disponibles para negociar.
DEFAULT_FREE_FLOAT_RATIO = 0.95

# Ventanas temporales del sistema (ver README de la pestana en el dashboard).
BACKTEST_START = pd.Timestamp("2018-01-01")
BACKTEST_END = pd.Timestamp("2023-12-31")
VALIDATION_START = pd.Timestamp("2024-01-01")
VALIDATION_END = pd.Timestamp("2025-12-31")
LIVE_START = pd.Timestamp("2026-01-01")

WINDOWS = {
    "Backtest (2018-2023)": (BACKTEST_START, BACKTEST_END),
    "Validacion Out-of-Sample (2024-2025)": (VALIDATION_START, VALIDATION_END),
    "Tiempo Real (2026-Presente)": (LIVE_START, None),  # None = hasta hoy
}


@dataclass
class TickerStaticInfo:
    """Datos 'estaticos' (no historicos) de un ETF: tamano y estructura de capital.

    yfinance no expone sharesOutstanding/marketCap/floatShares de forma
    confiable para ETFs (suelen venir en None) -- solo totalAssets (AUM)
    esta poblado de forma consistente. Por eso:
      - market_cap se aproxima con totalAssets (AUM), que es el equivalente
        real de "tamano" para un ETF (no hay capitalizacion bursatil propia).
      - shares_outstanding se deriva como totalAssets / precio_actual
        cuando el campo viene vacio (aproximacion estandar: AUM = shares * NAV).
      - free_float usa floatShares si existe; si no, el proxy configurable.
    """

    ticker: str
    market_cap: float
    shares_outstanding: float
    free_float: float
    source: str  # 'info' | 'proxy' -- para que la UI pueda avisar si es estimado


def fetch_ticker_static_info(
    ticker: str, free_float_ratio: float = DEFAULT_FREE_FLOAT_RATIO
) -> TickerStaticInfo | None:
    """Obtiene market cap / shares outstanding / free float actuales de un ETF.

    Devuelve None si Yahoo Finance no responde nada usable -- el llamador
    debe decidir como degradar (excluir el sector, avisar en la UI, etc.).
    """
    try:
        t = yf.Ticker(ticker)
        info = t.info or {}
    except Exception:
        info = {}

    shares = info.get("sharesOutstanding")
    market_cap = info.get("marketCap")
    float_shares = info.get("floatShares")
    total_assets = info.get("totalAssets")
    last_price = info.get("regularMarketPrice") or info.get("navPrice")

    source = "info"

    if market_cap is None:
        market_cap = total_assets
        source = "proxy"

    if shares is None:
        if total_assets and last_price:
            shares = total_assets / last_price
            source = "proxy"
        elif market_cap and last_price:
            shares = market_cap / last_price
            source = "proxy"

    if not market_cap or not shares:
        # Sin AUM ni precio no hay forma honesta de estimar nada: mejor
        # avisar con None que inventar un numero.
        return None

    if float_shares is None:
        float_shares = shares * free_float_ratio
        source = "proxy"

    return TickerStaticInfo(
        ticker=ticker,
        market_cap=float(market_cap),
        shares_outstanding=float(shares),
        free_float=float(float_shares),
        source=source,
    )


def download_price_history(
    tickers: list[str], start: pd.Timestamp, end: pd.Timestamp | None = None
) -> dict[str, pd.DataFrame]:
    """Descarga OHLCV diario ajustado para una lista de tickers en un solo request.

    Devuelve {ticker: DataFrame(Open,High,Low,Close,Volume)}. Un ticker que
    falla o no tiene datos en el rango simplemente no aparece en el dict --
    el llamador debe manejar la ausencia (nunca se inventan precios).
    """
    if end is None:
        end = pd.Timestamp.today().normalize() + timedelta(days=1)

    result: dict[str, pd.DataFrame] = {}
    try:
        raw = yf.download(
            tickers, start=start, end=end, auto_adjust=True, progress=False, group_by="column"
        )
    except Exception:
        return result

    if raw is None or raw.empty:
        return result

    for ticker in tickers:
        try:
            sub = raw.xs(ticker, axis=1, level="Ticker")
        except KeyError:
            continue
        sub = sub.dropna(subset=["Close"]).sort_index()
        if not sub.empty:
            result[ticker] = sub

    return result


# ─── Metricas de densidad de capital ───────────────────────────────────────


def compute_density_metrics(
    price_df: pd.DataFrame, static_info: TickerStaticInfo, rolling_window: int = 20
) -> pd.DataFrame:
    """Calcula VMC, STR, FFT y el Indicador Compuesto de Densidad (ICD).

    - VMC: (volumen * cierre) / market_cap  -> densidad de liquidez en dolares.
    - STR: volumen / shares_outstanding      -> rotacion de acciones en circulacion.
    - FFT: volumen / free_float              -> rotacion sobre el flotante libre.
    - ICD: promedio del z-score (rolling_window dias) de las 3 metricas.

    Nota metodologica: como shares_outstanding y free_float son constantes
    (valores actuales, no historicos -- limitacion real de yfinance para
    ETFs), STR y FFT son multiplos constantes entre si (free_float = shares *
    ratio fijo). Su z-score sale identico dia a dia; en la practica el ICD
    queda dominado por VMC (liquidez en dolares) y STR/FFT aportando la
    misma senal de "rotacion de acciones" dos veces. Se deja asi porque es
    la formula pedida explicitamente; queda documentado para no sorprender
    a quien audite el modelo despues.
    """
    df = price_df.copy()
    df["VMC"] = (df["Volume"] * df["Close"]) / static_info.market_cap
    df["STR"] = df["Volume"] / static_info.shares_outstanding
    df["FFT"] = df["Volume"] / static_info.free_float

    for col in ("VMC", "STR", "FFT"):
        mean = df[col].rolling(rolling_window, min_periods=rolling_window).mean()
        std = df[col].rolling(rolling_window, min_periods=rolling_window).std()
        df[f"z_{col}"] = (df[col] - mean) / std.replace(0, np.nan)

    df["ICD"] = df[["z_VMC", "z_STR", "z_FFT"]].mean(axis=1)

    # z-score del propio ICD sobre su media/std moviles: es el que se usa
    # para marcar "eventos" de anomalia (ICD > N desviaciones estandar).
    icd_mean = df["ICD"].rolling(rolling_window, min_periods=rolling_window).mean()
    icd_std = df["ICD"].rolling(rolling_window, min_periods=rolling_window).std()
    df["ICD_zscore"] = (df["ICD"] - icd_mean) / icd_std.replace(0, np.nan)

    return df


def compute_all_sectors_density(
    price_histories: dict[str, pd.DataFrame],
    static_infos: dict[str, TickerStaticInfo],
    rolling_window: int = 20,
) -> dict[str, pd.DataFrame]:
    """Aplica compute_density_metrics a todos los sectores disponibles."""
    out: dict[str, pd.DataFrame] = {}
    for ticker, price_df in price_histories.items():
        info = static_infos.get(ticker)
        if info is None:
            continue
        out[ticker] = compute_density_metrics(price_df, info, rolling_window)
    return out


def slice_window(
    df: pd.DataFrame, start: pd.Timestamp, end: pd.Timestamp | None
) -> pd.DataFrame:
    """Recorta un DataFrame indexado por fecha al rango [start, end]."""
    if end is None:
        return df.loc[df.index >= start]
    return df.loc[(df.index >= start) & (df.index <= end)]


# ─── Mapa de rotacion (heatmap) ────────────────────────────────────────────


def build_rotation_matrix(
    sector_metrics: dict[str, pd.DataFrame], window_days: int = 30
) -> pd.DataFrame:
    """Matriz sectores (filas) x ultimos `window_days` dias (columnas) de ICD.

    Pensada para el heatmap: mostrar como el "brillo" de capital se mueve
    de un sector a otro dia a dia.
    """
    rows = {}
    for ticker, df in sector_metrics.items():
        series = df["ICD"].dropna()
        if series.empty:
            continue
        rows[ticker] = series.tail(window_days)

    if not rows:
        return pd.DataFrame()

    matrix = pd.DataFrame(rows).T  # sectores en filas, fechas en columnas
    matrix.index = [SECTOR_NAMES.get(t, t) for t in matrix.index]
    return matrix


def latest_ranking(sector_metrics: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Tabla resumen: sectores ordenados por ICD mas reciente (mayor densidad primero)."""
    rows = []
    for ticker, df in sector_metrics.items():
        if df.empty or df["ICD"].dropna().empty:
            continue
        last = df.dropna(subset=["ICD"]).iloc[-1]
        rows.append(
            {
                "Ticker": ticker,
                "Sector": SECTOR_NAMES.get(ticker, ticker),
                "Fecha": last.name.date(),
                "Cierre": round(float(last["Close"]), 2),
                "Volumen": int(last["Volume"]),
                "VMC (z)": round(float(last["z_VMC"]), 2) if pd.notna(last["z_VMC"]) else None,
                "STR (z)": round(float(last["z_STR"]), 2) if pd.notna(last["z_STR"]) else None,
                "FFT (z)": round(float(last["z_FFT"]), 2) if pd.notna(last["z_FFT"]) else None,
                "ICD": round(float(last["ICD"]), 3) if pd.notna(last["ICD"]) else None,
            }
        )
    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows).sort_values("ICD", ascending=False, na_position="last").reset_index(drop=True)


# ─── Backtesting: correlacion rezagada ─────────────────────────────────────

LAGS = (1, 3, 5, 10)


def lag_correlation_matrix(
    sector_metrics: dict[str, pd.DataFrame], lags: tuple[int, ...] = LAGS
) -> pd.DataFrame:
    """Correlacion de Pearson entre ICD_zscore(t) y el retorno futuro a `lag` dias.

    Fila = sector, columna = lag (dias). Mide si un pico de densidad de
    capital hoy anticipa (o coincide con) el movimiento de precio de los
    proximos 1/3/5/10 dias.
    """
    rows = {}
    for ticker, df in sector_metrics.items():
        icd_z = df["ICD_zscore"]
        close = df["Close"]
        corr_row = {}
        for lag in lags:
            fwd_return = close.shift(-lag) / close - 1
            aligned = pd.concat([icd_z, fwd_return], axis=1, keys=["icd", "fwd"]).dropna()
            if len(aligned) < 30:
                corr_row[f"{lag}d"] = np.nan
            else:
                corr_row[f"{lag}d"] = aligned["icd"].corr(aligned["fwd"])
        rows[ticker] = corr_row

    matrix = pd.DataFrame(rows).T
    matrix.index = [SECTOR_NAMES.get(t, t) for t in matrix.index]
    return matrix


def event_study(
    sector_metrics: dict[str, pd.DataFrame],
    z_threshold: float = 2.0,
    lags: tuple[int, ...] = LAGS,
) -> pd.DataFrame:
    """Retorno futuro promedio condicionado a un 'evento' de anomalia de ICD.

    Evento: ICD_zscore > z_threshold. Compara el retorno futuro promedio
    condicional (post-evento) contra el retorno futuro promedio incondicional
    del mismo sector -- si el condicional es consistentemente mayor, el
    indicador tiene poder predictivo real, no es ruido.
    """
    rows = []
    for ticker, df in sector_metrics.items():
        icd_z = df["ICD_zscore"]
        close = df["Close"]
        event_mask = icd_z > z_threshold
        n_events = int(event_mask.sum())

        row = {"Ticker": ticker, "Sector": SECTOR_NAMES.get(ticker, ticker), "N eventos": n_events}
        for lag in lags:
            fwd_return = close.shift(-lag) / close - 1
            cond_mean = fwd_return[event_mask].mean()
            uncond_mean = fwd_return.mean()
            row[f"Ret. post-evento {lag}d"] = round(float(cond_mean), 4) if pd.notna(cond_mean) else None
            row[f"Ret. base {lag}d"] = round(float(uncond_mean), 4) if pd.notna(uncond_mean) else None
        rows.append(row)

    if not rows:
        return pd.DataFrame()
    return pd.DataFrame(rows)


# ─── Estrategia simulada: rotacion por delta de ICD ────────────────────────


def simulate_icd_rotation_strategy(
    sector_metrics: dict[str, pd.DataFrame],
    lookback_days: int = 3,
    hold_days: int = 5,
) -> pd.Series:
    """Estrategia: cada `hold_days`, comprar el sector con mayor incremento de
    ICD en los ultimos `lookback_days` y mantenerlo `hold_days`.

    Devuelve la curva de equity (base 1.0) indexada por fecha de rebalanceo,
    para poder graficarla junto al benchmark Buy & Hold.
    """
    icd_by_sector = {t: df["ICD"] for t, df in sector_metrics.items() if not df["ICD"].dropna().empty}
    close_by_sector = {t: df["Close"] for t, df in sector_metrics.items()}

    if not icd_by_sector:
        return pd.Series(dtype=float)

    icd_matrix = pd.DataFrame(icd_by_sector).dropna(how="all")
    delta_icd = icd_matrix - icd_matrix.shift(lookback_days)
    delta_icd = delta_icd.dropna(how="all")

    dates = delta_icd.index
    equity = [1.0]
    equity_dates = [dates[0]] if len(dates) else []

    i = 0
    while i < len(dates):
        rebalance_date = dates[i]
        row = delta_icd.loc[rebalance_date].dropna()
        if row.empty:
            i += 1
            continue

        chosen_sector = row.idxmax()
        close_series = close_by_sector.get(chosen_sector)
        if close_series is None or rebalance_date not in close_series.index:
            i += 1
            continue

        future_dates = close_series.index[close_series.index > rebalance_date]
        if len(future_dates) < hold_days:
            break
        exit_date = future_dates[hold_days - 1]

        entry_price = close_series.loc[rebalance_date]
        exit_price = close_series.loc[exit_date]
        trade_return = (exit_price / entry_price) - 1

        equity.append(equity[-1] * (1 + trade_return))
        equity_dates.append(exit_date)

        # Avanzar el indice hasta despues de la fecha de salida.
        next_positions = np.searchsorted(dates, exit_date, side="right")
        if next_positions <= i:
            break
        i = next_positions

    if len(equity_dates) < 2:
        return pd.Series(dtype=float)

    return pd.Series(equity, index=equity_dates, name="Estrategia ICD")


def buy_and_hold_curve(price_df: pd.DataFrame, aligned_dates: pd.Index) -> pd.Series:
    """Curva de equity Buy & Hold (base 1.0) para el benchmark, re-muestreada
    a las mismas fechas que la curva de la estrategia (para poder graficarlas
    juntas de forma comparable)."""
    close = price_df["Close"].reindex(price_df.index.union(aligned_dates)).sort_index().ffill()
    close = close.reindex(aligned_dates)
    if close.empty or pd.isna(close.iloc[0]) or close.iloc[0] == 0:
        return pd.Series(dtype=float)
    return (close / close.iloc[0]).rename("Buy & Hold SPY")
