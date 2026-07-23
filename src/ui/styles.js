export const CSS_STYLES = `
    /* ===== iDesk RPA Minimalist UI v3.0 (Bento Card Feed - Direct Scroll) ===== */
    #idesk-rpa-hub {
        position: fixed !important;
        bottom: 20px !important;
        right: 20px !important;
        width: min(1200px, 95vw) !important;
        height: min(780px, 88vh) !important;
        background: #121212 !important;
        border: 1px solid #282828 !important;
        border-radius: 8px !important;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4) !important;
        color: #EAEAEA !important;
        font-family: 'SF Pro Display', 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        z-index: 999999 !important;
        display: flex !important;
        flex-direction: column !important;
        overflow: hidden !important;
        font-size: 13px !important;
        line-height: 1.5 !important;
        transition: width 0.25s ease, height 0.25s ease, border-radius 0.25s ease !important;
        user-select: none !important;
    }
    #idesk-rpa-hub.rpa-dragging { transition: none !important; }
    #idesk-rpa-hub * { box-sizing: border-box !important; }

    #idesk-rpa-hub.minimized {
        width: 340px !important;
        height: 42px !important;
        border-radius: 6px !important;
    }
    #idesk-rpa-hub.minimized .rpa-body,
    #idesk-rpa-hub.minimized .rpa-footer { display: none !important; }

    .rpa-header {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 10px 16px !important;
        background: #181818 !important;
        border-bottom: 1px solid #262626 !important;
        cursor: grab !important;
        min-height: 42px !important;
    }
    .rpa-header:active { cursor: grabbing !important; }

    .rpa-title {
        font-weight: 600 !important;
        font-size: 14px !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        color: #FFFFFF !important;
        letter-spacing: -0.01em !important;
    }
    .rpa-title .badge-count {
        background: #262626 !important;
        color: #A1A1AA !important;
        font-size: 11px !important;
        padding: 1px 8px !important;
        border-radius: 9999px !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
    }

    .rpa-header-actions { display: flex !important; gap: 6px !important; }
    .rpa-header-actions button {
        background: transparent !important;
        border: 1px solid #2A2A2A !important;
        color: #A1A1AA !important;
        cursor: pointer !important;
        padding: 4px 10px !important;
        border-radius: 4px !important;
        font-size: 11px !important;
        transition: all 0.15s !important;
    }
    .rpa-header-actions button:hover {
        background: #262626 !important;
        color: #FFFFFF !important;
    }

    .rpa-body {
        flex: 1 !important;
        padding: 14px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
        overflow: hidden !important;
    }

    .rpa-toolbar {
        display: flex !important;
        gap: 12px !important;
        align-items: center !important;
        background: #161618 !important;
        padding: 8px 12px !important;
        border-radius: 6px !important;
        border: 1px solid #242427 !important;
    }

    .rpa-select-all-label {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        font-size: 12px !important;
        color: #A1A1AA !important;
        cursor: pointer !important;
        user-select: none !important;
        margin-left: auto !important;
    }
    .rpa-select-all-label input { cursor: pointer !important; }

    .rpa-btn {
        background: #1A1A1A !important;
        border: 1px solid #333333 !important;
        color: #EAEAEA !important;
        border-radius: 4px !important;
        padding: 7px 16px !important;
        font-weight: 500 !important;
        font-size: 12px !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        transition: background 0.15s, transform 0.1s !important;
    }
    .rpa-btn:hover { background: #262626 !important; color: #FFFFFF !important; }
    .rpa-btn:active { transform: scale(0.98) !important; }

    .rpa-btn-primary {
        background: #FFFFFF !important;
        color: #111111 !important;
        border: 1px solid #FFFFFF !important;
        font-weight: 600 !important;
    }
    .rpa-btn-primary:hover { background: #E5E5E5 !important; }

    .rpa-btn-purple {
        background: #EAEAEA !important;
        color: #111111 !important;
        border: 1px solid #EAEAEA !important;
        font-weight: 600 !important;
    }
    .rpa-btn-purple:hover { background: #D4D4D4 !important; }

    .rpa-btn-outline {
        background: transparent !important;
        border: 1px solid #2E2E2E !important;
        color: #A1A1AA !important;
    }
    .rpa-btn-outline:hover { border-color: #444444 !important; color: #FFFFFF !important; }

    /* ===== CARD FEED WRAPPER ===== */
    .rpa-feed-wrap {
        flex: 1 !important;
        overflow-y: auto !important;
        padding-right: 4px !important;
    }
    .rpa-feed-wrap::-webkit-scrollbar { width: 6px !important; }
    .rpa-feed-wrap::-webkit-scrollbar-thumb { background: #282828 !important; border-radius: 3px !important; }

    .rpa-card-feed {
        display: flex !important;
        flex-direction: column !important;
        gap: 14px !important;
    }

    .rpa-empty-state {
        text-align: center !important;
        color: #71717A !important;
        padding: 48px 20px !important;
        background: #161618 !important;
        border: 1px solid #262626 !important;
        border-radius: 8px !important;
        font-size: 13px !important;
    }

    /* ===== DOCUMENT BENTO CARD ===== */
    .rpa-doc-card {
        background: #161618 !important;
        border: 1px solid #28282B !important;
        border-radius: 8px !important;
        padding: 14px 16px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
        transition: border-color 0.15s, background 0.15s !important;
    }
    .rpa-doc-card:hover {
        border-color: #3F3F46 !important;
        background: #18181B !important;
    }

    /* Card Header — flex-wrap badges row */
    .rpa-card-header {
        display: flex !important;
        align-items: flex-start !important;
        gap: 8px !important;
        padding-bottom: 10px !important;
        border-bottom: 1px solid #242427 !important;
    }
    .rpa-card-header-left {
        flex: 1 !important;
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
        flex-wrap: wrap !important;
        min-width: 0 !important;
    }
    .rpa-card-header-right {
        flex-shrink: 0 !important;
        display: flex !important;
        align-items: center !important;
    }

    /* === Unified Badge Chip (Header metadata) === */
    .rpa-badge-chip {
        display: inline-flex !important;
        align-items: center !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        font-size: 11px !important;
        font-weight: 500 !important;
        color: #C4C4C7 !important;
        background: #1E1E21 !important;
        border: 1px solid #2E2E32 !important;
        padding: 2px 8px !important;
        border-radius: 4px !important;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        max-width: 260px !important;
        line-height: 1.4 !important;
        transition: border-color 0.12s, background 0.12s !important;
    }
    .rpa-badge-chip:hover {
        border-color: #4A4A50 !important;
        background: #252529 !important;
    }
    .rpa-badge-chip.is-signnumber {
        color: #FFFFFF !important;
        font-weight: 700 !important;
        background: #28282E !important;
        border-color: #3A3A42 !important;
        font-size: 12px !important;
    }
    .rpa-badge-chip.is-signnumber:hover {
        background: #303036 !important;
        border-color: #505058 !important;
    }

    /* === Priority chip — subtle accent, not louder than signnumber === */
    .rpa-badge-chip.is-priority {
        color: #F5A623 !important;
        background: #2A2315 !important;
        border-color: #3D2F1A !important;
    }

    /* === Status Badge (pill, round) === */
    .rpa-badge {
        display: inline-flex !important;
        align-items: center !important;
        padding: 3px 10px !important;
        border-radius: 9999px !important;
        font-weight: 500 !important;
        font-size: 11px !important;
        letter-spacing: 0.03em !important;
        text-transform: uppercase !important;
    }
    .rpa-badge-idle { background: #27272A !important; color: #A1A1AA !important; }
    .rpa-badge-pending { background: #E1F3FE !important; color: #1F6C9F !important; }
    .rpa-badge-success { background: #EDF3EC !important; color: #346538 !important; }
    .rpa-badge-error { background: #FDEBEC !important; color: #9F2F2D !important; }
    .rpa-badge-sent { background: #E1F3FE !important; color: #1F6C9F !important; }

    /* Card Body */
    .rpa-card-body {
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
    }

    .rpa-card-subject {
        font-size: 14px !important;
        font-weight: 600 !important;
        color: #F4F4F5 !important;
        line-height: 1.5 !important;
    }
    .rpa-subject-label {
        color: #71717A !important;
        font-weight: 500 !important;
        font-size: 12px !important;
        text-transform: uppercase !important;
        margin-right: 4px !important;
    }

    /* AI Summary Callout */
    .rpa-card-summary {
        background: #111113 !important;
        border: 1px solid #242427 !important;
        border-left: 3px solid #EAEAEA !important;
        border-radius: 6px !important;
        padding: 10px 14px !important;
    }
    .rpa-summary-title {
        font-size: 10px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.08em !important;
        color: #A1A1AA !important;
        font-weight: 600 !important;
        margin-bottom: 4px !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
    }
    .rpa-summary-text {
        font-size: 13px !important;
        color: #E4E4E7 !important;
        line-height: 1.6 !important;
        white-space: pre-wrap !important;
    }

    /* === Assignment Grid (4 columns: unit, co-unit, leader, deadline) === */
    .rpa-assignment-grid {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 10px !important;
        background: #131315 !important;
        border: 1px solid #222225 !important;
        padding: 10px 12px !important;
        border-radius: 6px !important;
    }

    .rpa-assign-item {
        display: flex !important;
        flex-direction: column !important;
        gap: 2px !important;
        min-width: 0 !important;
    }
    .rpa-assign-item.span-full {
        grid-column: 1 / -1 !important;
    }

    .rpa-assign-label {
        font-size: 10px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.05em !important;
        color: #71717A !important;
        font-weight: 600 !important;
    }
    .rpa-assign-value {
        font-size: 12px !important;
        color: #D4D4D8 !important;
        line-height: 1.4 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
    }
    .rpa-assign-value.is-main-unit {
        color: #FFFFFF !important;
        font-weight: 600 !important;
    }
    .rpa-assign-value.is-deadline {
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        color: #FFFFFF !important;
        font-weight: 500 !important;
    }

    .rpa-unit-tags {
        display: flex !important;
        flex-wrap: wrap !important;
        gap: 4px !important;
    }
    .rpa-unit-pill {
        background: #242427 !important;
        border: 1px solid #333338 !important;
        color: #D4D4D8 !important;
        padding: 1px 7px !important;
        border-radius: 4px !important;
        font-size: 11px !important;
    }

    /* ===== LOG PANEL ===== */
    .rpa-log-panel {
        display: none !important;
        height: 120px !important;
        background: #0A0A0A !important;
        border: 1px solid #222222 !important;
        border-radius: 4px !important;
        padding: 8px !important;
        font-family: 'Geist Mono', 'SF Mono', monospace !important;
        font-size: 11px !important;
        overflow-y: auto !important;
        color: #00FF66 !important;
    }
    .rpa-log-panel.open { display: block !important; }

    /* ===== FOOTER ===== */
    .rpa-footer {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 8px 16px !important;
        background: #181818 !important;
        border-top: 1px solid #262626 !important;
        font-size: 11px !important;
        color: #888888 !important;
    }

    .rpa-progress-wrap {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
    }
    .rpa-progress-bar {
        width: 100px !important;
        height: 6px !important;
        background: #262626 !important;
        border-radius: 3px !important;
        overflow: hidden !important;
    }
    .rpa-progress-fill {
        width: 0% !important;
        height: 100% !important;
        background: #FFFFFF !important;
        transition: width 0.2s ease !important;
    }
`;
