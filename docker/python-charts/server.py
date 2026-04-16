"""
Publication-Grade Statistical Plot Generation Server

Renders matplotlib/seaborn plots styled for Q1 academic journals.
Accepts JSON plot specifications and returns base64-encoded PNG images.
"""

import base64
import io
import json
import traceback

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np
import seaborn as sns
from flask import Flask, request, jsonify
from scipy import stats

app = Flask(__name__)

# ---------------------------------------------------------------------------
# Journal style presets
# ---------------------------------------------------------------------------

JOURNAL_STYLES = {
    "nature": {
        "font.family": "sans-serif",
        "font.sans-serif": ["Helvetica", "Arial", "DejaVu Sans"],
        "font.size": 8,
        "axes.titlesize": 9,
        "axes.labelsize": 8,
        "xtick.labelsize": 7,
        "ytick.labelsize": 7,
        "legend.fontsize": 7,
        "figure.dpi": 300,
        "savefig.dpi": 300,
        "axes.linewidth": 0.6,
        "xtick.major.width": 0.6,
        "ytick.major.width": 0.6,
        "lines.linewidth": 1.2,
        "axes.spines.top": False,
        "axes.spines.right": False,
    },
    "ieee": {
        "font.family": "serif",
        "font.serif": ["Times New Roman", "DejaVu Serif"],
        "font.size": 8,
        "axes.titlesize": 9,
        "axes.labelsize": 8,
        "xtick.labelsize": 7,
        "ytick.labelsize": 7,
        "legend.fontsize": 7,
        "figure.dpi": 300,
        "savefig.dpi": 300,
        "axes.linewidth": 0.5,
        "xtick.major.width": 0.5,
        "ytick.major.width": 0.5,
        "lines.linewidth": 1.0,
        "axes.spines.top": False,
        "axes.spines.right": False,
    },
    "elsevier": {
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans"],
        "font.size": 9,
        "axes.titlesize": 10,
        "axes.labelsize": 9,
        "xtick.labelsize": 8,
        "ytick.labelsize": 8,
        "legend.fontsize": 8,
        "figure.dpi": 300,
        "savefig.dpi": 300,
        "axes.linewidth": 0.6,
        "lines.linewidth": 1.2,
        "axes.spines.top": False,
        "axes.spines.right": False,
    },
    "default": {
        "font.family": "sans-serif",
        "font.sans-serif": ["Helvetica", "Arial", "DejaVu Sans"],
        "font.size": 9,
        "axes.titlesize": 10,
        "axes.labelsize": 9,
        "xtick.labelsize": 8,
        "ytick.labelsize": 8,
        "legend.fontsize": 8,
        "figure.dpi": 300,
        "savefig.dpi": 300,
        "axes.linewidth": 0.6,
        "lines.linewidth": 1.2,
        "axes.spines.top": False,
        "axes.spines.right": False,
    },
}

ACADEMIC_PALETTE = ["#4E79A7", "#F28E2B", "#E15759", "#76B7B2",
                    "#59A14F", "#EDC948", "#B07AA1", "#FF9DA7"]

# Single column ~3.5 in, double column ~7 in at 300 DPI
FIGURE_SIZES = {
    "single_column": (3.5, 2.8),
    "double_column": (7.0, 4.5),
    "square": (3.5, 3.5),
    "wide": (7.0, 3.0),
}


def apply_journal_style(journal: str = "default"):
    style = JOURNAL_STYLES.get(journal, JOURNAL_STYLES["default"])
    plt.rcParams.update(style)
    sns.set_palette(ACADEMIC_PALETTE)


def fig_to_base64(fig, fmt="png"):
    buf = io.BytesIO()
    fig.savefig(buf, format=fmt, bbox_inches="tight", facecolor="white",
                edgecolor="none", pad_inches=0.1)
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


# ---------------------------------------------------------------------------
# Plot renderers
# ---------------------------------------------------------------------------

def render_boxplot(spec):
    data = spec["data"]
    groups = data.get("groups", {})
    labels = list(groups.keys())
    values = [groups[k] for k in labels]

    figsize = FIGURE_SIZES.get(spec.get("figureSize", "single_column"), (3.5, 2.8))
    fig, ax = plt.subplots(figsize=figsize)

    show_points = spec.get("showDataPoints", True)
    if show_points:
        parts = ax.boxplot(values, labels=labels, patch_artist=True,
                           widths=0.5, showfliers=False)
        for i, vals in enumerate(values):
            jitter = np.random.normal(0, 0.04, len(vals))
            ax.scatter(np.full(len(vals), i + 1) + jitter, vals,
                       alpha=0.4, s=12, color=ACADEMIC_PALETTE[i % len(ACADEMIC_PALETTE)],
                       zorder=3, edgecolors="none")
    else:
        parts = ax.boxplot(values, labels=labels, patch_artist=True, widths=0.5)

    for i, patch in enumerate(parts["boxes"]):
        color = ACADEMIC_PALETTE[i % len(ACADEMIC_PALETTE)]
        patch.set_facecolor(color + "40")
        patch.set_edgecolor(color)

    if spec.get("title"):
        ax.set_title(spec["title"], pad=8)
    if spec.get("yAxisLabel"):
        ax.set_ylabel(spec["yAxisLabel"])
    if spec.get("xAxisLabel"):
        ax.set_xlabel(spec["xAxisLabel"])

    return fig


def render_violin(spec):
    data = spec["data"]
    groups = data.get("groups", {})
    labels = list(groups.keys())
    values = [groups[k] for k in labels]

    figsize = FIGURE_SIZES.get(spec.get("figureSize", "single_column"), (3.5, 2.8))
    fig, ax = plt.subplots(figsize=figsize)

    parts = ax.violinplot(values, showmeans=True, showmedians=True)
    for i, pc in enumerate(parts["bodies"]):
        color = ACADEMIC_PALETTE[i % len(ACADEMIC_PALETTE)]
        pc.set_facecolor(color + "60")
        pc.set_edgecolor(color)

    ax.set_xticks(range(1, len(labels) + 1))
    ax.set_xticklabels(labels)

    if spec.get("title"):
        ax.set_title(spec["title"], pad=8)
    if spec.get("yAxisLabel"):
        ax.set_ylabel(spec["yAxisLabel"])
    if spec.get("xAxisLabel"):
        ax.set_xlabel(spec["xAxisLabel"])

    return fig


def render_heatmap(spec):
    data = spec["data"]
    matrix = np.array(data["matrix"])
    row_labels = data.get("rowLabels", [f"R{i}" for i in range(matrix.shape[0])])
    col_labels = data.get("colLabels", [f"C{i}" for i in range(matrix.shape[1])])

    figsize = FIGURE_SIZES.get(spec.get("figureSize", "single_column"), (3.5, 3.5))
    fig, ax = plt.subplots(figsize=figsize)

    cmap = spec.get("colormap", "YlOrRd")
    annot = spec.get("annotate", True)

    sns.heatmap(matrix, xticklabels=col_labels, yticklabels=row_labels,
                annot=annot, fmt=spec.get("fmt", ".2f"), cmap=cmap,
                linewidths=0.5, linecolor="white", ax=ax, cbar_kws={"shrink": 0.8})

    if spec.get("title"):
        ax.set_title(spec["title"], pad=8)

    return fig


def render_confusion_matrix(spec):
    data = spec["data"]
    matrix = np.array(data["matrix"])
    labels = data.get("labels", [f"Class {i}" for i in range(matrix.shape[0])])

    figsize = FIGURE_SIZES.get(spec.get("figureSize", "square"), (3.5, 3.5))
    fig, ax = plt.subplots(figsize=figsize)

    sns.heatmap(matrix, xticklabels=labels, yticklabels=labels,
                annot=True, fmt="d", cmap="Blues",
                linewidths=0.5, linecolor="white", ax=ax, cbar=False)
    ax.set_xlabel("Predicted")
    ax.set_ylabel("Actual")

    if spec.get("title"):
        ax.set_title(spec["title"], pad=8)

    return fig


def render_roc_curve(spec):
    data = spec["data"]
    curves = data.get("curves", [])

    figsize = FIGURE_SIZES.get(spec.get("figureSize", "square"), (3.5, 3.5))
    fig, ax = plt.subplots(figsize=figsize)

    for i, curve in enumerate(curves):
        fpr = curve["fpr"]
        tpr = curve["tpr"]
        auc_val = curve.get("auc", np.trapz(tpr, fpr))
        label = curve.get("label", f"Model {i+1}")
        color = ACADEMIC_PALETTE[i % len(ACADEMIC_PALETTE)]
        ax.plot(fpr, tpr, color=color, lw=1.5, label=f"{label} (AUC={auc_val:.3f})")

    ax.plot([0, 1], [0, 1], "k--", lw=0.8, alpha=0.5, label="Random")
    ax.set_xlim([0, 1])
    ax.set_ylim([0, 1.02])
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.legend(loc="lower right", frameon=True, fancybox=False, edgecolor="#cccccc")

    if spec.get("title"):
        ax.set_title(spec["title"], pad=8)

    return fig


def render_error_bar(spec):
    data = spec["data"]
    categories = data.get("categories", [])
    series_list = data.get("series", [])

    figsize = FIGURE_SIZES.get(spec.get("figureSize", "single_column"), (3.5, 2.8))
    fig, ax = plt.subplots(figsize=figsize)

    n_series = len(series_list)
    bar_width = 0.7 / max(n_series, 1)
    x = np.arange(len(categories))

    for i, series in enumerate(series_list):
        offset = (i - (n_series - 1) / 2) * bar_width
        color = ACADEMIC_PALETTE[i % len(ACADEMIC_PALETTE)]
        ax.bar(x + offset, series["values"], bar_width,
               yerr=series.get("errors"), capsize=3,
               color=color + "B0", edgecolor=color, linewidth=0.6,
               label=series.get("label", f"Series {i+1}"),
               error_kw={"elinewidth": 0.8, "capthick": 0.8})

    ax.set_xticks(x)
    ax.set_xticklabels(categories)
    if n_series > 1:
        ax.legend(frameon=True, fancybox=False, edgecolor="#cccccc")

    if spec.get("title"):
        ax.set_title(spec["title"], pad=8)
    if spec.get("yAxisLabel"):
        ax.set_ylabel(spec["yAxisLabel"])
    if spec.get("xAxisLabel"):
        ax.set_xlabel(spec["xAxisLabel"])

    # Significance brackets
    for bracket in spec.get("significanceBrackets", []):
        _draw_significance(ax, bracket, x, series_list)

    return fig


def _draw_significance(ax, bracket, x_positions, series_list):
    """Draw significance bracket between two groups."""
    g1 = bracket.get("group1", 0)
    g2 = bracket.get("group2", 1)
    text = bracket.get("text", "*")

    all_vals = []
    for s in series_list:
        all_vals.extend(s["values"])
        if "errors" in s:
            all_vals.extend([v + e for v, e in zip(s["values"], s["errors"])])
    y_max = max(all_vals) if all_vals else 1
    y_offset = y_max * 0.05

    x1 = x_positions[g1] if g1 < len(x_positions) else g1
    x2 = x_positions[g2] if g2 < len(x_positions) else g2
    y = y_max + y_offset * (1 + bracket.get("tier", 0))

    ax.plot([x1, x1, x2, x2], [y - y_offset * 0.3, y, y, y - y_offset * 0.3],
            lw=0.8, color="#333333")
    ax.text((x1 + x2) / 2, y, text, ha="center", va="bottom", fontsize=7)


def render_regression(spec):
    data = spec["data"]
    x_vals = np.array(data["x"])
    y_vals = np.array(data["y"])

    figsize = FIGURE_SIZES.get(spec.get("figureSize", "square"), (3.5, 3.5))
    fig, ax = plt.subplots(figsize=figsize)

    ax.scatter(x_vals, y_vals, s=20, alpha=0.6, color=ACADEMIC_PALETTE[0],
               edgecolors="none", zorder=3)

    slope, intercept, r_val, p_val, std_err = stats.linregress(x_vals, y_vals)
    x_line = np.linspace(x_vals.min(), x_vals.max(), 100)
    y_line = slope * x_line + intercept
    ax.plot(x_line, y_line, color=ACADEMIC_PALETTE[1], lw=1.5,
            label=f"y={slope:.3f}x+{intercept:.3f}\n$R^2$={r_val**2:.3f}")

    if spec.get("showConfidenceBand", True):
        n = len(x_vals)
        y_pred = slope * x_vals + intercept
        se = np.sqrt(np.sum((y_vals - y_pred) ** 2) / (n - 2))
        x_mean = np.mean(x_vals)
        ss_x = np.sum((x_vals - x_mean) ** 2)
        ci = 1.96 * se * np.sqrt(1 / n + (x_line - x_mean) ** 2 / ss_x)
        ax.fill_between(x_line, y_line - ci, y_line + ci,
                         alpha=0.15, color=ACADEMIC_PALETTE[1])

    ax.legend(frameon=True, fancybox=False, edgecolor="#cccccc")

    if spec.get("title"):
        ax.set_title(spec["title"], pad=8)
    if spec.get("xAxisLabel"):
        ax.set_xlabel(spec["xAxisLabel"])
    if spec.get("yAxisLabel"):
        ax.set_ylabel(spec["yAxisLabel"])

    return fig


def render_bland_altman(spec):
    data = spec["data"]
    method1 = np.array(data["method1"])
    method2 = np.array(data["method2"])

    mean_vals = (method1 + method2) / 2
    diff_vals = method1 - method2
    mean_diff = np.mean(diff_vals)
    std_diff = np.std(diff_vals)

    figsize = FIGURE_SIZES.get(spec.get("figureSize", "single_column"), (3.5, 2.8))
    fig, ax = plt.subplots(figsize=figsize)

    ax.scatter(mean_vals, diff_vals, s=20, alpha=0.6,
               color=ACADEMIC_PALETTE[0], edgecolors="none")
    ax.axhline(mean_diff, color=ACADEMIC_PALETTE[1], ls="-", lw=1.0,
               label=f"Mean: {mean_diff:.3f}")
    ax.axhline(mean_diff + 1.96 * std_diff, color=ACADEMIC_PALETTE[2],
               ls="--", lw=0.8, label=f"+1.96 SD: {mean_diff + 1.96 * std_diff:.3f}")
    ax.axhline(mean_diff - 1.96 * std_diff, color=ACADEMIC_PALETTE[2],
               ls="--", lw=0.8, label=f"-1.96 SD: {mean_diff - 1.96 * std_diff:.3f}")

    ax.set_xlabel("Mean of two methods")
    ax.set_ylabel("Difference")
    ax.legend(fontsize=6, frameon=True, fancybox=False, edgecolor="#cccccc")

    if spec.get("title"):
        ax.set_title(spec["title"], pad=8)

    return fig


def render_forest_plot(spec):
    data = spec["data"]
    studies = data.get("studies", [])

    figsize = FIGURE_SIZES.get(spec.get("figureSize", "single_column"), (3.5, max(2.0, len(studies) * 0.35)))
    fig, ax = plt.subplots(figsize=figsize)

    y_positions = list(range(len(studies)))

    for i, study in enumerate(studies):
        effect = study["effect"]
        ci_low = study.get("ci_low", effect - 0.5)
        ci_high = study.get("ci_high", effect + 0.5)
        weight = study.get("weight", 1.0)

        color = ACADEMIC_PALETTE[0] if study.get("type") != "summary" else ACADEMIC_PALETTE[1]
        marker_size = max(4, min(12, weight * 4))

        ax.errorbar(effect, i, xerr=[[effect - ci_low], [ci_high - effect]],
                     fmt="s", color=color, markersize=marker_size,
                     capsize=2, capthick=0.8, elinewidth=0.8)

    ax.set_yticks(y_positions)
    ax.set_yticklabels([s.get("label", f"Study {i+1}") for i, s in enumerate(studies)])
    ax.axvline(spec.get("nullEffect", 0), color="#999999", ls="--", lw=0.6)
    ax.invert_yaxis()

    if spec.get("xAxisLabel"):
        ax.set_xlabel(spec["xAxisLabel"])
    if spec.get("title"):
        ax.set_title(spec["title"], pad=8)

    return fig


def render_custom_code(spec):
    """Execute user-provided matplotlib code in a sandboxed namespace."""
    code = spec.get("code", "")
    if not code:
        raise ValueError("No code provided")

    figsize = FIGURE_SIZES.get(spec.get("figureSize", "single_column"), (3.5, 2.8))
    fig, ax = plt.subplots(figsize=figsize)

    safe_globals = {
        "plt": plt, "np": np, "sns": sns, "fig": fig, "ax": ax,
        "stats": stats, "ACADEMIC_PALETTE": ACADEMIC_PALETTE,
        "__builtins__": {"range": range, "len": len, "list": list,
                         "dict": dict, "zip": zip, "enumerate": enumerate,
                         "min": min, "max": max, "sum": sum, "abs": abs,
                         "round": round, "sorted": sorted, "str": str,
                         "int": int, "float": float, "bool": bool,
                         "True": True, "False": False, "None": None},
    }

    exec(code, safe_globals)
    return fig


RENDERERS = {
    "boxplot": render_boxplot,
    "violin": render_violin,
    "heatmap": render_heatmap,
    "confusion_matrix": render_confusion_matrix,
    "roc_curve": render_roc_curve,
    "error_bar": render_error_bar,
    "regression": render_regression,
    "bland_altman": render_bland_altman,
    "forest_plot": render_forest_plot,
    "custom": render_custom_code,
}


# ---------------------------------------------------------------------------
# API endpoint
# ---------------------------------------------------------------------------

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "renderers": list(RENDERERS.keys())})


@app.route("/render", methods=["POST"])
def render():
    try:
        spec = request.get_json(force=True)
        plot_type = spec.get("plotType", "")
        journal = spec.get("journal", "default")

        if plot_type not in RENDERERS:
            return jsonify({"success": False,
                            "error": f"Unknown plotType: {plot_type}. "
                                     f"Supported: {list(RENDERERS.keys())}"}), 400

        apply_journal_style(journal)
        fig = RENDERERS[plot_type](spec)
        image_b64 = fig_to_base64(fig, fmt="png")

        return jsonify({"success": True, "imageBase64": image_b64,
                        "format": "png", "plotType": plot_type})

    except Exception as exc:
        traceback.print_exc()
        return jsonify({"success": False, "error": str(exc)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5100, debug=False)
