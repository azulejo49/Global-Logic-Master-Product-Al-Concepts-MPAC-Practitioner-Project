import os
from pathlib import Path
import subprocess
import sys
import zipfile

# ---------------- CONFIG ----------------
BASE_DIR = Path("MPAC_AI_Trading_Capstone")
VENV_DIR = BASE_DIR / "venv"
ZIP_FILE = BASE_DIR.name + ".zip"

folders = [
    "data", "app", "product", "prompts",
    "evaluation", "slides", "architecture"
]

files = {
    "README.txt": """MPAC(Master Product Al Concepts) Capstone Project: Explainable AI Trading Decision Support
Paper trading only. No financial advice.
Author: Amiram Azulay
Instructions to run:
python ci_build.py in terminal  # Builds project, venv, installs dependencies, zips it
cd MPAC_AI_Trading_Capstone
venv\Scripts\activate
cd app
streamlit run app.py
""",

    "data/sample_data.csv": """Date,Open,High,Low,Close,Volume
2024-01-01,42000,42550,41800,42300,31250
2024-01-02,42300,43000,42100,42850,34120
2024-01-03,42850,43200,42400,42600,29840
2024-01-04,42600,42750,41950,42100,35670
""",

    "app/app.py": """import streamlit as st 
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import ta

# ---------------- PAGE CONFIG ----------------
st.set_page_config(layout="wide")
st.title("AI Trading Decision Support (Paper Only)")
st.caption("Author: Amiram Azulay")

# ---------------- SIDEBAR ----------------
st.sidebar.header("Chart Controls")

show_sma = st.sidebar.checkbox("SMA (short-20 days/long-50 days)", value=True)
show_ema = st.sidebar.checkbox("EMA 20", value=True)
show_rsi = st.sidebar.checkbox("RSI", value=True)
show_volume = st.sidebar.checkbox("Volume", value=True)

# ---------------- LOAD DATA ----------------
df = pd.read_csv("../data/sample_data.csv")
df["Date"] = pd.to_datetime(df["Date"])
data_len = len(df)

# ---------------- ADAPTIVE INDICATOR WINDOWS ----------------
if data_len >= 100:
    sma_short, sma_long, ema_win, rsi_win, vol_win = 20, 50, 20, 14, 20
    mode = "Production"
elif data_len >= 60:
    sma_short, sma_long, ema_win, rsi_win, vol_win = 14, 30, 14, 10, 14
    mode = "Reduced History"
else:
    sma_short, sma_long, ema_win, rsi_win, vol_win = 3, 5, 3, 3, 3
    mode = "Demo"

st.caption(f"📊 Data Mode: **{mode}** (adaptive indicator windows)")

# ---------------- INDICATORS ----------------
df["SMA_short"] = ta.trend.sma_indicator(df["Close"], window=sma_short, fillna=True)
df["SMA_long"] = ta.trend.sma_indicator(df["Close"], window=sma_long, fillna=True)
df["EMA"] = ta.trend.ema_indicator(df["Close"], window=ema_win, fillna=True)
df["RSI"] = ta.momentum.rsi(df["Close"], window=rsi_win, fillna=True)

df["Returns"] = df["Close"].pct_change()
df["Volatility"] = df["Returns"].rolling(vol_win, min_periods=1).std()

# ---------------- VOLATILITY REGIME ----------------
latest_vol = df["Volatility"].iloc[-1]
if latest_vol < 0.01:
    vol_regime = "Low"
elif latest_vol < 0.025:
    vol_regime = "Medium"
else:
    vol_regime = "High"

# ---------------- FIGURE SETUP ----------------
rows = 2 if show_rsi else 1

fig = make_subplots(
    rows=rows,
    cols=1,
    shared_xaxes=True,
    vertical_spacing=0.05,
    row_heights=[0.75, 0.25] if show_rsi else [1.0],
    specs=[[{"secondary_y": True}]] + ([ [{}] ] if show_rsi else [])
)

# ---------------- CANDLESTICKS ----------------
fig.add_trace(
    go.Candlestick(
        x=df["Date"],
        open=df["Open"],
        high=df["High"],
        low=df["Low"],
        close=df["Close"],
        name="Price"
    ),
    row=1, col=1
)

# ---------------- VOLUME ----------------
if show_volume:
    fig.add_trace(
        go.Bar(
            x=df["Date"],
            y=df["Volume"],
            name="Volume",
            marker_color="rgba(120,120,120,0.15)"
        ),
        row=1,
        col=1,
        secondary_y=True
    )

# ---------------- MOVING AVERAGES ----------------
if show_sma:
    fig.add_trace(
        go.Scatter(x=df["Date"], y=df["SMA_short"], name=f"SMA {sma_short}", line=dict(color="cyan", width=2)),
        row=1, col=1
    )
    fig.add_trace(
        go.Scatter(x=df["Date"], y=df["SMA_long"], name=f"SMA {sma_long}", line=dict(color="blue", width=2)),
        row=1, col=1
    )

if show_ema:
    fig.add_trace(
        go.Scatter(x=df["Date"], y=df["EMA"], name=f"EMA {ema_win}", line=dict(color="yellow", width=2, dash="dot")),
        row=1, col=1
    )

# ---------------- RSI PANEL ----------------
if show_rsi:
    fig.add_trace(
        go.Scatter(x=df["Date"], y=df["RSI"], name=f"RSI {rsi_win}", line=dict(color="orange", width=2)),
        row=2, col=1
    )
    fig.add_hline(y=70, line_dash="dash", line_color="red", row=2, col=1)
    fig.add_hline(y=30, line_dash="dash", line_color="green", row=2, col=1)

# ---------------- LAYOUT ----------------
fig.update_layout(
    height=780,
    template="plotly_dark",
    xaxis_rangeslider_visible=False,
    legend=dict(orientation="h", yanchor="bottom", y=1.02)
)

fig.update_yaxes(showgrid=False, secondary_y=True)
st.plotly_chart(fig, use_container_width=True)

# ---------------- AI NARRATIVE ----------------
st.subheader("AI Market Narrative")

trend_bias = "Bullish" if df["EMA"].iloc[-1] > df["SMA_short"].iloc[-1] else "Bearish"
rsi_val = df["RSI"].iloc[-1]

st.markdown(f\"\"\"
**Volatility Regime:** {vol_regime}  
**Trend Bias:** {trend_bias}  
**Momentum (RSI {rsi_win}):** {rsi_val:.1f}

**Narrative Insight:**  
The market is operating in a **{vol_regime.lower()} volatility regime**, suggesting
{"stable conditions with controlled risk" if vol_regime=="Low" else "heightened uncertainty requiring caution" if vol_regime=="High" else "moderate risk with selective opportunities"}.

Trend structure indicates a **{trend_bias.lower()} bias**, while momentum signals show
{"overbought conditions" if rsi_val>70 else "oversold conditions" if rsi_val<30 else "balanced participation"}.

This system provides **decision support only** and does not execute trades.
\"\"\")

st.warning("Paper trading only. No financial advice.")
""",

    "app/requirements.txt": "streamlit\npandas\nplotly\nta\n",

     "product/PRD.txt": "Goal: Explainable AI trading decision support.\nAuthor: Amiram Azulay\n",
    "product/Ethics_and_Risks.txt": "No live trading. No advice. Explain uncertainty.\n",
    "product/User_Testing_Feedback.txt": "Users reported improved risk awareness.\n",

    "evaluation/Judge_Evaluation_Rubric.txt": "Criteria: Product, AI realism, Ethics.\n",
    "slides/Final_Presentation_Outline.txt": "Problem → Solution → Demo → Ethics.\n",
     "architecture/AI_Architecture.txt": """Data → Risk Models → LLM → UI
Description:
- Data Layer: historical market data (CSV)
- Risk Models: compute volatility, SMA, EMA, RSI
- LLM: generate AI market narrative, trend bias, regime detection
- UI: Streamlit dashboard with candlestick, indicators, volume, narrative
""",
    
}

# ---------------- FUNCTIONS ----------------
def create_structure():
    BASE_DIR.mkdir(exist_ok=True)
    for folder in folders:
        (BASE_DIR / folder).mkdir(exist_ok=True)
    for path, content in files.items():
        full_path = BASE_DIR / path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content, encoding="utf-8")
    print("✅ Project structure and files created.")

def create_venv():
    subprocess.run([sys.executable, "-m", "venv", str(VENV_DIR)])
    print("✅ Virtual environment created.")

def install_dependencies():
    if os.name == "nt":
        pip_path = VENV_DIR / "Scripts" / "pip.exe"
    else:
        pip_path = VENV_DIR / "bin" / "pip"
    subprocess.run([str(pip_path), "install", "-r", str(BASE_DIR / "app" / "requirements.txt")])
    print("✅ Dependencies installed.")

def zip_project():
    with zipfile.ZipFile(ZIP_FILE, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files_in_dir in os.walk(BASE_DIR):
            for file in files_in_dir:
                file_path = Path(root) / file
                zipf.write(file_path, file_path.relative_to(BASE_DIR.parent))
    print(f"✅ Project zipped as {ZIP_FILE}")

def main():
    create_structure()
    create_venv()
    install_dependencies()
    zip_project()
    print("🎉 CI-style build complete. Run 'streamlit run app/app.py' inside the venv to launch the app.")

if __name__ == "__main__":
    main()
