
(() => {
  "use strict";

  const APP_CONTEXT = document.body?.dataset?.appContext || "web";
  const IS_EXTENSION_RUNTIME =
    typeof chrome !== "undefined" &&
    !!chrome.runtime?.id &&
    !!chrome.identity?.launchWebAuthFlow;
  const IS_EXTENSION_CONTEXT = APP_CONTEXT === "extension" || IS_EXTENSION_RUNTIME;

  if (handleOAuthCallbackPage()) {
    return;
  }

  const DATA_KEY = "rememberUnifiedDataV2";
  const VIEW_MODE_KEY = "rememberViewModeV1";
  const THEME_KEY = "rememberThemeV1";
  const GOOGLE_CONFIG_KEY = "rememberGoogleConfigV1";
  const GOOGLE_TOKEN_KEY = "rememberGoogleTokenV1";
  const DRIVE_SYNC_CACHE_KEY = "rememberDriveSyncCacheV1";
  const DEFAULT_FOLDER_NAME = "기본";
  const AUTO_SYNC_DELAY_MS = 600;
  const AUTO_SYNC_ERROR_COOLDOWN_MS = 15000;
  const AUTO_SYNC_MASS_DELETE_MIN_ITEMS = 8;
  const AUTO_SYNC_MASS_DELETE_RATIO = 0.55;
  const AUTO_SYNC_FULL_RECONCILE_MS = 45000;

  const DRIVE_FILE_NAME = "remember-sync-v2.json";
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";

  let selectedTags = [];
  let selectedFolder = "";
  let currentSort = "recentAdd";
  let currentViewMode = "magazine";
  let isDarkMode = false;
  let deletedItem = null;
  let undoTimeout = null;
  let editId = null;
  let sheetMode = "add";
  let smartFilter = "";
  let metadataRequestInFlight = 0;
  let syncInFlight = false;
  let autoSyncTimer = null;
  let autoSyncPending = false;
  let autoSyncForceFull = false;
  let lastAutoSyncErrorAt = 0;

  const searchInput = byId("searchInput");
  const sortSelect = byId("sortSelect");
  const folderFilterSelect = byId("folderFilterSelect");
  const viewToggleButtons = Array.from(document.querySelectorAll("[data-view-mode]"));
  const cardsContainer = byId("cardsContainer");
  const tagFiltersDiv = byId("tagFilters");
  const suggestionsDiv = byId("suggestions");
  const sheetOverlay = byId("sheetOverlay");
  const sheet = byId("sheet");
  const sheetTitle = byId("sheetTitle");
  const step1 = byId("step1");
  const step2 = byId("step2");
  const siteUrlInput = byId("siteUrl");
  const siteNameInput = byId("siteName");
  const siteFolderInput = byId("siteFolder");
  const siteThumbUrlInput = byId("siteThumbUrl");
  const siteFaviconUrlInput = byId("siteFaviconUrl");
  const siteTagsInput = byId("siteTags");
  const siteDescInput = byId("siteDesc");
  const metadataPreview = byId("metadataPreview");
  const metadataThumb = byId("metadataThumb");
  const metadataFavicon = byId("metadataFavicon");
  const metadataDomain = byId("metadataDomain");
  const metadataDescription = byId("metadataDescription");
  const metadataHint = byId("metadataHint");
  const cancelBtn1 = byId("cancelBtn1");
  const nextBtn = byId("nextBtn");
  const backBtn = byId("backBtn");
  const saveBtn = byId("saveBtn");
  const openSheetBtn = byId("openSheetBtn");
  const toastContainer = byId("toastContainer");
  const exportBtn = byId("exportBtn");
  const importBtn = byId("importBtn");
  const importFileInput = byId("importFile");
  const bookmarkletBtn = byId("bookmarkletBtn");
  const saveCurrentTabBtn = byId("saveCurrentTabBtn");
  const settingsOverlay = byId("settingsOverlay");
  const openSettingsBtn = byId("openSettingsBtn");
  const closeSettingsBtn = byId("closeSettingsBtn");
  const themeToggleBtn = byId("themeToggleBtn");

  const readerOverlay = byId("readerOverlay");
  const readerCloseBtn = byId("readerCloseBtn");
  const readerOpenOriginal = byId("readerOpenOriginal");
  const readerTitle = byId("readerTitle");
  const readerSubline = byId("readerSubline");
  const readerImages = byId("readerImages");
  const readerBody = byId("readerBody");

  const driveStatusEl = byId("driveStatus");
  const driveConnectBtn = byId("driveConnectBtn");
  const driveSyncBtn = byId("driveSyncBtn");
  const drivePushBtn = byId("drivePushBtn");
  const drivePullBtn = byId("drivePullBtn");
  const googleClientIdInput = byId("googleClientIdInput");
  const saveGoogleConfigBtn = byId("saveGoogleConfigBtn");
  const clearGoogleConfigBtn = byId("clearGoogleConfigBtn");

  if (
    !searchInput ||
    !sortSelect ||
    !folderFilterSelect ||
    !cardsContainer ||
    !tagFiltersDiv ||
    !suggestionsDiv
  ) {
    return;
  }

  loadUiPreferences();
  applyTheme();
  updateThemeToggleLabel();
  applyViewModeClass();
  updateViewToggleButtons();
  bindUiEvents();
  loadSavedGoogleConfig();
  refreshDriveStatus();
  render();
  checkIncomingUrl();
  scheduleAutoSync({ immediate: true, fullReconcile: true });

  function byId(id) {
    return document.getElementById(id);
  }

  function loadUiPreferences() {
    const savedMode = localStorage.getItem(VIEW_MODE_KEY);
    if (savedMode === "grid" || savedMode === "list" || savedMode === "magazine") {
      currentViewMode = savedMode;
    }

    isDarkMode = localStorage.getItem(THEME_KEY) === "dark";
  }

  function saveViewMode(mode) {
    currentViewMode = mode;
    localStorage.setItem(VIEW_MODE_KEY, mode);
    applyViewModeClass();
    updateViewToggleButtons();
    renderBookmarks();
  }

  function applyViewModeClass() {
    if (!cardsContainer) {
      return;
    }
    cardsContainer.classList.remove("view-grid", "view-list", "view-magazine");
    cardsContainer.classList.add(`view-${currentViewMode}`);
  }

  function updateViewToggleButtons() {
    viewToggleButtons.forEach((button) => {
      const mode = button.dataset.viewMode;
      button.classList.toggle("active", mode === currentViewMode);
    });
  }

  function applyTheme() {
    document.body.dataset.theme = isDarkMode ? "dark" : "light";
    localStorage.setItem(THEME_KEY, isDarkMode ? "dark" : "light");
  }

  function updateThemeToggleLabel() {
    if (!themeToggleBtn) {
      return;
    }
    themeToggleBtn.textContent = isDarkMode ? "라이트 모드 켜기" : "다크 모드 켜기";
  }

  function handleOAuthCallbackPage() {
    const params = new URLSearchParams(window.location.search);
    const isCallback = params.get("oauth_callback") === "1";
    if (!isCallback || !window.opener) {
      return false;
    }

    window.opener.postMessage(
      {
        source: "remember-oauth",
        hash: window.location.hash || ""
      },
      window.location.origin
    );

    window.close();
    return true;
  }

  function bindUiEvents() {
    sortSelect.addEventListener("change", function () {
      currentSort = this.value;
      renderBookmarks();
    });

    folderFilterSelect?.addEventListener("change", function () {
      selectedFolder = this.value;
      renderBookmarks();
    });

    viewToggleButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.viewMode;
        if (!mode || mode === currentViewMode) {
          return;
        }
        saveViewMode(mode);
      });
    });

    searchInput.addEventListener("input", () => {
      smartFilter = "";
      renderBookmarks();
    });

    cancelBtn1?.addEventListener("click", closeSheet);

    backBtn?.addEventListener("click", () => {
      if (sheetMode === "add") {
        step1.classList.add("active");
        step2.classList.remove("active");
      } else {
        closeSheet();
      }
    });

    nextBtn?.addEventListener("click", async () => {
      const normalized = normalizeUrl(siteUrlInput.value.trim());
      if (!normalized) {
        alert("올바른 URL을 입력해주세요");
        return;
      }

      siteUrlInput.value = normalized;
      if (!siteNameInput.value.trim()) {
        siteNameInput.value = suggestName(normalized);
      }

      await autofillMetadataFromUrl(normalized);

      step1.classList.remove("active");
      step2.classList.add("active");
    });

    siteUrlInput?.addEventListener("blur", () => {
      const normalized = normalizeUrl(siteUrlInput.value.trim());
      if (!normalized) {
        return;
      }
      autofillMetadataFromUrl(normalized);
    });

    saveBtn?.addEventListener("click", saveBookmarkFromSheet);
    openSheetBtn?.addEventListener("click", openAdd);
    openSettingsBtn?.addEventListener("click", openSettings);
    closeSettingsBtn?.addEventListener("click", closeSettings);
    themeToggleBtn?.addEventListener("click", () => {
      isDarkMode = !isDarkMode;
      applyTheme();
      updateThemeToggleLabel();
    });

    sheetOverlay?.addEventListener("click", (event) => {
      if (event.target === sheetOverlay) {
        closeSheet();
      }
    });

    settingsOverlay?.addEventListener("click", (event) => {
      if (event.target === settingsOverlay) {
        closeSettings();
      }
    });

    readerOverlay?.addEventListener("click", (event) => {
      if (event.target === readerOverlay) {
        closeReader();
      }
    });

    readerCloseBtn?.addEventListener("click", closeReader);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }
      closeSheet();
      closeSettings();
      closeReader();
    });

    exportBtn?.addEventListener("click", exportData);
    importBtn?.addEventListener("click", () => importFileInput?.click());
    importFileInput?.addEventListener("change", importData);

    bookmarkletBtn?.addEventListener("click", copyBookmarkletCode);

    saveCurrentTabBtn?.addEventListener("click", () => {
      if (!IS_EXTENSION_CONTEXT) {
        return;
      }
      captureCurrentTabToSheet();
    });

    driveConnectBtn?.addEventListener("click", () => {
      runDriveTask(async () => {
        await ensureGoogleToken();
        scheduleAutoSync({ immediate: true, fullReconcile: true });
        showToast("Google Drive 연결 완료");
      });
    });

    driveSyncBtn?.addEventListener("click", () => {
      runDriveTask(async () => {
        await syncWithDrive();
        render();
        showToast("양방향 동기화 완료");
      });
    });

    drivePushBtn?.addEventListener("click", () => {
      runDriveTask(async () => {
        await uploadLocalToDrive();
        showToast("Drive에 저장 완료");
      });
    });

    drivePullBtn?.addEventListener("click", () => {
      runDriveTask(async () => {
        const loaded = await downloadDriveToLocal();
        if (!loaded) {
          showToast("Drive에 저장된 데이터가 없습니다");
          return;
        }
        render();
        showToast("Drive 데이터 불러오기 완료");
      });
    });

    saveGoogleConfigBtn?.addEventListener("click", () => {
      const clientId = (googleClientIdInput?.value || "").trim();
      if (!clientId) {
        alert("OAuth Client ID를 입력해주세요");
        return;
      }
      if (!clientId.includes(".apps.googleusercontent.com")) {
        alert("Client ID 형식이 올바르지 않습니다");
        return;
      }

      saveGoogleConfig(clientId);
      clearGoogleToken();
      clearDriveSyncCache();
      cancelAutoSync();
      refreshDriveStatus();
      showToast("Client ID를 저장했습니다");
    });

    clearGoogleConfigBtn?.addEventListener("click", () => {
      if (!confirm("Google 연동 설정과 토큰을 지울까요?")) {
        return;
      }
      clearGoogleConfig();
      clearGoogleToken();
      clearDriveSyncCache();
      cancelAutoSync();
      if (googleClientIdInput) {
        googleClientIdInput.value = "";
      }
      refreshDriveStatus();
      showToast("Google 설정을 초기화했습니다");
    });

    window.addEventListener("focus", () => {
      scheduleAutoSync({ immediate: true, fullReconcile: true });
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        scheduleAutoSync({ immediate: true, fullReconcile: true });
      }
    });
  }

  function loadSavedGoogleConfig() {
    const config = getGoogleConfig();
    if (googleClientIdInput && config.clientId) {
      googleClientIdInput.value = config.clientId;
    }
  }

  function refreshDriveStatus(mode) {
    if (!driveStatusEl) {
      return;
    }

    if (mode === "syncing") {
      driveStatusEl.textContent = "작업중";
      driveStatusEl.className = "drive-status syncing";
      return;
    }

    const token = getStoredGoogleToken();
    if (token) {
      driveStatusEl.textContent = "연결됨";
      driveStatusEl.className = "drive-status connected";
      return;
    }

    driveStatusEl.textContent = "미연결";
    driveStatusEl.className = "drive-status offline";
  }

  function getDriveSyncCache() {
    const raw = localStorage.getItem(DRIVE_SYNC_CACHE_KEY);
    if (!raw) {
      return { fileId: "", lastFullSyncAt: 0, lastFastSyncAt: 0 };
    }

    try {
      const parsed = JSON.parse(raw);
      return {
        fileId: String(parsed.fileId || "").trim(),
        lastFullSyncAt: toSafeNumber(parsed.lastFullSyncAt, 0),
        lastFastSyncAt: toSafeNumber(parsed.lastFastSyncAt, 0)
      };
    } catch (_error) {
      return { fileId: "", lastFullSyncAt: 0, lastFastSyncAt: 0 };
    }
  }

  function saveDriveSyncCache(patch = {}) {
    const current = getDriveSyncCache();
    const next = {
      fileId: String(
        Object.prototype.hasOwnProperty.call(patch, "fileId") ? patch.fileId : current.fileId
      ).trim(),
      lastFullSyncAt: toSafeNumber(
        Object.prototype.hasOwnProperty.call(patch, "lastFullSyncAt")
          ? patch.lastFullSyncAt
          : current.lastFullSyncAt,
        0
      ),
      lastFastSyncAt: toSafeNumber(
        Object.prototype.hasOwnProperty.call(patch, "lastFastSyncAt")
          ? patch.lastFastSyncAt
          : current.lastFastSyncAt,
        0
      )
    };

    localStorage.setItem(DRIVE_SYNC_CACHE_KEY, JSON.stringify(next));
  }

  function clearDriveSyncCache() {
    localStorage.removeItem(DRIVE_SYNC_CACHE_KEY);
  }

  function shouldRunPeriodicFullSync() {
    const cache = getDriveSyncCache();
    if (!cache.fileId) {
      return true;
    }
    return Date.now() - cache.lastFullSyncAt >= AUTO_SYNC_FULL_RECONCILE_MS;
  }

  function canAutoSync() {
    const config = getGoogleConfig();
    if (!config.clientId) {
      return false;
    }
    return !!getStoredGoogleToken();
  }

  function cancelAutoSync() {
    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = null;
    }
    autoSyncPending = false;
    autoSyncForceFull = false;
  }

  function scheduleAutoSync(options = {}) {
    if (options.fullReconcile) {
      autoSyncForceFull = true;
    }

    if (!canAutoSync()) {
      cancelAutoSync();
      return;
    }

    if (autoSyncTimer) {
      clearTimeout(autoSyncTimer);
      autoSyncTimer = null;
    }

    if (syncInFlight) {
      autoSyncPending = true;
      return;
    }

    const delay = options.immediate ? 80 : AUTO_SYNC_DELAY_MS;
    autoSyncTimer = setTimeout(() => {
      const fullReconcile = autoSyncForceFull;
      autoSyncForceFull = false;
      autoSyncTimer = null;
      runAutoSync({ fullReconcile });
    }, delay);
  }

  function runAutoSync(options = {}) {
    if (!canAutoSync()) {
      cancelAutoSync();
      return;
    }

    const fullReconcile = options.fullReconcile === true || shouldRunPeriodicFullSync();

    if (syncInFlight) {
      autoSyncPending = true;
      if (fullReconcile) {
        autoSyncForceFull = true;
      }
      return;
    }

    let syncResult = { skipped: false, message: "" };

    runDriveTask(
      async () => {
        syncResult = await syncWithDrive({
          interactive: false,
          safeMode: true,
          mode: fullReconcile ? "full" : "autoFast"
        });

        if (!syncResult?.skipped && fullReconcile) {
          render();
        }
      },
      { silent: true }
    ).then((succeeded) => {
      if (syncResult?.skipped) {
        const now = Date.now();
        if (now - lastAutoSyncErrorAt >= AUTO_SYNC_ERROR_COOLDOWN_MS) {
          lastAutoSyncErrorAt = now;
          showToast(syncResult.message || "자동 동기화를 안전모드로 중단했습니다");
        }
        return;
      }

      if (succeeded) {
        lastAutoSyncErrorAt = 0;
        return;
      }

      const now = Date.now();
      if (now - lastAutoSyncErrorAt >= AUTO_SYNC_ERROR_COOLDOWN_MS) {
        lastAutoSyncErrorAt = now;
        showToast("자동 동기화 실패: 설정에서 Drive 상태를 확인해주세요");
      }
    });
  }

  function runDriveTask(task, options = {}) {
    if (syncInFlight) {
      return Promise.resolve(false);
    }

    syncInFlight = true;
    refreshDriveStatus("syncing");

    return Promise.resolve()
      .then(task)
      .then(() => true)
      .catch((error) => {
        if (!options.silent) {
          const message =
            error instanceof Error ? error.message : "Drive 작업 중 오류가 발생했습니다";
          showToast(message);
        }
        return false;
      })
      .finally(() => {
        refreshDriveStatus();
        syncInFlight = false;

        if (autoSyncPending) {
          const shouldResume = canAutoSync();
          const fullReconcile = autoSyncForceFull;
          autoSyncPending = false;
          autoSyncForceFull = false;
          if (!shouldResume) {
            return;
          }
          scheduleAutoSync({ immediate: true, fullReconcile });
        }
      });
  }
  function render() {
    applyViewModeClass();
    updateViewToggleButtons();
    renderFolderFilters();
    renderTagFilters();
    renderSuggestions();
    renderBookmarks();
  }

  function renderFolderFilters() {
    if (!folderFilterSelect) {
      return;
    }

    const bookmarks = getBookmarks();
    const folders = Array.from(
      new Set(
        bookmarks
          .map((item) => normalizeFolderName(item.folder || ""))
          .filter((folder) => folder)
      )
    ).sort((a, b) => a.localeCompare(b));

    folderFilterSelect.innerHTML = "";
    const allOption = document.createElement("option");
    allOption.value = "";
    allOption.textContent = "전체 폴더";
    folderFilterSelect.appendChild(allOption);

    folders.forEach((folder) => {
      const option = document.createElement("option");
      option.value = folder;
      option.textContent = folder;
      folderFilterSelect.appendChild(option);
    });

    if (selectedFolder && folders.includes(selectedFolder)) {
      folderFilterSelect.value = selectedFolder;
      return;
    }

    selectedFolder = "";
    folderFilterSelect.value = "";
  }

  function renderTagFilters() {
    tagFiltersDiv.innerHTML = "";
    const bookmarks = getBookmarks();
    const tagCounts = {};

    bookmarks.forEach((item) => {
      (item.tags || []).forEach((tag) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });

    const tags = Object.keys(tagCounts).sort((a, b) => a.localeCompare(b));
    tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip" + (selectedTags.includes(tag) ? " selected" : "");
      chip.textContent = tag;
      chip.onclick = () => toggleTagFilter(tag);
      tagFiltersDiv.appendChild(chip);
    });
  }

  function renderSuggestions() {
    suggestionsDiv.innerHTML = "";

    appendSuggestion("최근 본", () => {
      smartFilter = "";
      searchInput.value = "";
      selectedTags = [];
      selectedFolder = "";
      sortSelect.value = "recentVisit";
      currentSort = "recentVisit";
      renderBookmarks();
      renderTagFilters();
      renderFolderFilters();
    });

    appendSuggestion("자주 본", () => {
      smartFilter = "";
      searchInput.value = "";
      selectedTags = [];
      selectedFolder = "";
      sortSelect.value = "frequent";
      currentSort = "frequent";
      renderBookmarks();
      renderTagFilters();
      renderFolderFilters();
    });

    const tagCounts = {};
    getBookmarks().forEach((item) => {
      (item.tags || []).forEach((tag) => {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      });
    });

    Object.keys(tagCounts)
      .sort((a, b) => tagCounts[b] - tagCounts[a])
      .slice(0, 3)
      .forEach((tag) => {
        appendSuggestion("#" + tag, () => {
          smartFilter = "";
          searchInput.value = "";
          selectedTags = [tag];
          selectedFolder = "";
          sortSelect.value = "recentAdd";
          currentSort = "recentAdd";
          renderBookmarks();
          renderTagFilters();
          renderFolderFilters();
        });
      });

    const domainCounts = {};
    getBookmarks().forEach((item) => {
      const domain = item.domain || "";
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    });

    Object.keys(domainCounts)
      .sort((a, b) => domainCounts[b] - domainCounts[a])
      .slice(0, 2)
      .forEach((domain) => {
        if (!domain) {
          return;
        }
        appendSuggestion(domain, () => {
          smartFilter = "";
          searchInput.value = "site:" + domain;
          selectedTags = [];
          selectedFolder = "";
          sortSelect.value = "recentAdd";
          currentSort = "recentAdd";
          renderBookmarks();
          renderTagFilters();
          renderFolderFilters();
        });
      });

    appendSuggestion("한달 이상 안 본", () => {
      smartFilter = "stale30";
      searchInput.value = "";
      selectedTags = [];
      selectedFolder = "";
      sortSelect.value = "recentAdd";
      currentSort = "recentAdd";
      renderBookmarks();
      renderTagFilters();
      renderFolderFilters();
    });
  }

  function appendSuggestion(text, onClick) {
    const el = document.createElement("span");
    el.className = "suggestion";
    el.textContent = text;
    el.onclick = onClick;
    suggestionsDiv.appendChild(el);
  }

  function renderBookmarks() {
    const all = getBookmarks().slice();
    const query = searchInput.value.trim();

    let domainFilter = null;
    let tagFilterQuery = null;
    let folderFilterQuery = null;

    if (query.startsWith("site:")) {
      domainFilter = query.slice(5).trim().toLowerCase();
    } else if (query.startsWith("#")) {
      tagFilterQuery = query.slice(1).trim().toLowerCase();
    } else if (query.startsWith("folder:")) {
      folderFilterQuery = query.slice(7).trim().toLowerCase();
    }

    const filtered = all.filter((item) => {
      let pass = true;
      const folderName = normalizeFolderName(item.folder || "");

      if (smartFilter === "stale30") {
        const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
        if (item.visitedAt) {
          pass = pass && item.visitedAt < threshold;
        }
      }

      if (domainFilter) {
        pass = pass && (item.domain || "").toLowerCase().includes(domainFilter);
      }

      if (tagFilterQuery) {
        pass = pass && (item.tags || []).some((tag) => tag.toLowerCase().includes(tagFilterQuery));
      }

      if (folderFilterQuery) {
        pass = pass && folderName.toLowerCase().includes(folderFilterQuery);
      }

      if (!domainFilter && !tagFilterQuery && !folderFilterQuery && query) {
        const text =
          `${item.name || ""} ${item.desc || ""} ${folderName} ${(item.tags || []).join(" ")}`.toLowerCase();
        pass = pass && text.includes(query.toLowerCase());
      }

      if (selectedTags.length) {
        pass = pass && selectedTags.every((tag) => (item.tags || []).includes(tag));
      }

      if (selectedFolder) {
        pass = pass && folderName === selectedFolder;
      }

      return pass;
    });

    filtered.sort((a, b) => {
      if (a.pinned && !b.pinned) {
        return -1;
      }
      if (!a.pinned && b.pinned) {
        return 1;
      }
      if (currentSort === "recentAdd") {
        return (b.createdAt || 0) - (a.createdAt || 0);
      }
      if (currentSort === "recentVisit") {
        return (b.visitedAt || 0) - (a.visitedAt || 0);
      }
      if (currentSort === "frequent") {
        return (b.visitCount || 0) - (a.visitCount || 0);
      }
      return 0;
    });

    cardsContainer.innerHTML = "";
    applyViewModeClass();

    if (!filtered.length) {
      const empty = document.createElement("p");
      empty.textContent = query || selectedTags.length || selectedFolder
        ? "검색 결과가 없습니다. 다른 키워드를 사용해보세요."
        : "아직 저장된 사이트가 없습니다. 하단 버튼으로 추가해보세요.";
      cardsContainer.appendChild(empty);
      return;
    }

    filtered.forEach((item) => {
      const card = document.createElement("div");
      card.className = "card";

      const pin = document.createElement("span");
      pin.className = "pin" + (item.pinned ? " pinned" : "");
      pin.textContent = item.pinned ? "★" : "☆";
      pin.onclick = () => togglePin(item.id);
      card.appendChild(pin);

      if (currentViewMode !== "list") {
        card.appendChild(createCardMedia(item));
      }

      const main = document.createElement("div");
      main.className = "card-main";

      const titleRow = document.createElement("div");
      titleRow.className = "card-title-row";

      const favicon = createFaviconImage(item.faviconUrl);
      titleRow.appendChild(favicon);

      const title = document.createElement("div");
      title.className = "card-title";
      title.textContent = item.name || item.url;
      titleRow.appendChild(title);

      const folder = document.createElement("span");
      folder.className = "card-folder";
      folder.textContent = normalizeFolderName(item.folder || "");
      titleRow.appendChild(folder);
      main.appendChild(titleRow);

      if (item.desc && currentViewMode !== "list") {
        const desc = document.createElement("div");
        desc.className = "card-desc";
        desc.textContent = item.desc;
        main.appendChild(desc);
      }

      if (item.tags && item.tags.length && currentViewMode !== "list") {
        const tags = document.createElement("div");
        tags.className = "card-tags";
        item.tags.forEach((tag) => {
          const span = document.createElement("span");
          span.textContent = tag;
          tags.appendChild(span);
        });
        main.appendChild(tags);
      }

      const parts = [];
      if (item.visitedAt) {
        parts.push(`마지막 방문: ${new Date(item.visitedAt).toLocaleDateString()}`);
      }
      if (item.visitCount) {
        parts.push(`${item.visitCount}회 방문`);
      }

      if (parts.length && currentViewMode !== "list") {
        const meta = document.createElement("div");
        meta.className = "card-meta";
        meta.textContent = parts.join(" · ");
        main.appendChild(meta);
      }

      const actions = document.createElement("div");
      actions.className = "card-actions";

      const openLink = document.createElement("a");
      openLink.href = item.url;
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer";
      openLink.textContent = "열기";
      openLink.onclick = () => {
        updateVisit(item.id);
      };
      actions.appendChild(openLink);

      const editButton = document.createElement("button");
      editButton.textContent = "수정";
      editButton.onclick = () => openEdit(item.id);
      actions.appendChild(editButton);

      const readButton = document.createElement("button");
      readButton.textContent = "읽기";
      readButton.onclick = () => openReader(item.id);
      actions.appendChild(readButton);

      const deleteButton = document.createElement("button");
      deleteButton.textContent = "삭제";
      deleteButton.onclick = () => deleteBookmark(item.id);
      actions.appendChild(deleteButton);

      main.appendChild(actions);
      card.appendChild(main);
      cardsContainer.appendChild(card);
    });
  }

  function createCardMedia(item) {
    const media = document.createElement("div");
    media.className = "card-media";

    if (item.thumbUrl) {
      const image = document.createElement("img");
      image.src = item.thumbUrl;
      image.alt = `${item.name || item.url} 썸네일`;
      media.appendChild(image);
      return media;
    }

    const fallback = document.createElement("div");
    fallback.className = "fallback";
    fallback.textContent = (item.domain || item.name || "?").slice(0, 1).toUpperCase();
    media.appendChild(fallback);
    return media;
  }

  function createFaviconImage(faviconUrl) {
    const favicon = document.createElement("img");
    favicon.className = "card-favicon";
    favicon.src = faviconUrl || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    favicon.alt = "";
    favicon.loading = "lazy";
    return favicon;
  }

  function toggleTagFilter(tag) {
    const index = selectedTags.indexOf(tag);
    if (index >= 0) {
      selectedTags.splice(index, 1);
    } else {
      selectedTags.push(tag);
    }
    smartFilter = "";
    renderBookmarks();
    renderTagFilters();
  }

  function openSettings() {
    if (!settingsOverlay) {
      return;
    }

    settingsOverlay.hidden = false;
    requestAnimationFrame(() => {
      settingsOverlay.classList.add("open");
    });
  }

  function closeSettings() {
    if (!settingsOverlay || settingsOverlay.hidden) {
      return;
    }

    settingsOverlay.classList.remove("open");
    setTimeout(() => {
      if (!settingsOverlay.classList.contains("open")) {
        settingsOverlay.hidden = true;
      }
    }, 250);
  }

  function openAdd() {
    sheetMode = "add";
    editId = null;
    sheetTitle.textContent = "새 사이트 추가";

    siteUrlInput.value = "";
    siteNameInput.value = "";
    if (siteFolderInput) {
      siteFolderInput.value = DEFAULT_FOLDER_NAME;
    }
    if (siteThumbUrlInput) {
      siteThumbUrlInput.value = "";
    }
    if (siteFaviconUrlInput) {
      siteFaviconUrlInput.value = "";
    }
    siteTagsInput.value = "";
    siteDescInput.value = "";
    setMetadataPreview(null);

    step1.classList.add("active");
    step2.classList.remove("active");

    sheetOverlay.style.display = "flex";
    setTimeout(() => sheet.classList.add("open"), 10);
  }

  function openAddPrefilled(url, name) {
    sheetMode = "add";
    editId = null;
    sheetTitle.textContent = "새 사이트 추가";

    siteUrlInput.value = url || "";
    siteNameInput.value = name || suggestName(url || "");
    if (siteFolderInput) {
      siteFolderInput.value = DEFAULT_FOLDER_NAME;
    }
    if (siteThumbUrlInput) {
      siteThumbUrlInput.value = "";
    }
    if (siteFaviconUrlInput) {
      siteFaviconUrlInput.value = "";
    }
    siteTagsInput.value = "";
    siteDescInput.value = "";
    setMetadataPreview(null);

    step1.classList.remove("active");
    step2.classList.add("active");

    sheetOverlay.style.display = "flex";
    setTimeout(() => sheet.classList.add("open"), 10);
    if (url) {
      autofillMetadataFromUrl(url);
    }
  }

  function openEdit(id) {
    const data = getData();
    const item = data.bookmarks.find((bookmark) => bookmark.id === id);
    if (!item) {
      return;
    }

    sheetMode = "edit";
    editId = id;
    sheetTitle.textContent = "사이트 수정";

    siteUrlInput.value = item.url;
    siteNameInput.value = item.name || "";
    if (siteFolderInput) {
      siteFolderInput.value = normalizeFolderName(item.folder || "");
    }
    if (siteThumbUrlInput) {
      siteThumbUrlInput.value = item.thumbUrl || "";
    }
    if (siteFaviconUrlInput) {
      siteFaviconUrlInput.value = item.faviconUrl || "";
    }
    siteTagsInput.value = (item.tags || []).join(" ");
    siteDescInput.value = item.desc || "";
    setMetadataPreview({
      image: item.thumbUrl || "",
      favicon: item.faviconUrl || "",
      description: item.desc || "",
      domain: item.domain || extractDomain(item.url)
    });

    step1.classList.remove("active");
    step2.classList.add("active");

    sheetOverlay.style.display = "flex";
    setTimeout(() => sheet.classList.add("open"), 10);
  }

  function closeSheet() {
    sheet.classList.remove("open");
    setTimeout(() => {
      sheetOverlay.style.display = "none";
    }, 250);
  }

  function setMetadataPreview(metadata) {
    if (!metadataPreview) {
      return;
    }

    if (!metadata || (!metadata.image && !metadata.favicon && !metadata.description && !metadata.domain)) {
      metadataPreview.hidden = true;
      if (metadataThumb) {
        metadataThumb.src = "";
        metadataThumb.style.display = "none";
      }
      if (metadataFavicon) {
        metadataFavicon.src = "";
        metadataFavicon.style.display = "none";
      }
      if (metadataDomain) {
        metadataDomain.textContent = "";
      }
      if (metadataDescription) {
        metadataDescription.textContent = "";
      }
      return;
    }

    metadataPreview.hidden = false;
    if (metadataThumb) {
      metadataThumb.src = metadata.image || "";
      metadataThumb.style.display = metadata.image ? "block" : "none";
    }
    if (metadataFavicon) {
      metadataFavicon.src = metadata.favicon || "";
      metadataFavicon.style.display = metadata.favicon ? "block" : "none";
    }
    if (metadataDomain) {
      metadataDomain.textContent = metadata.domain || "";
    }
    if (metadataDescription) {
      metadataDescription.textContent = metadata.description || "설명 정보를 찾지 못했습니다.";
    }
  }

  function setMetadataHint(text) {
    if (!metadataHint) {
      return;
    }
    metadataHint.textContent = text;
  }

  async function autofillMetadataFromUrl(url) {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      return;
    }

    const requestId = Date.now() + Math.random();
    metadataRequestInFlight = requestId;
    setMetadataHint("메타데이터를 불러오는 중...");
    if (nextBtn) {
      nextBtn.disabled = true;
    }

    try {
      const metadata = await extractMetadataForUrl(normalized);
      if (metadataRequestInFlight !== requestId) {
        return;
      }

      const currentName = (siteNameInput?.value || "").trim();
      if (!currentName || currentName === suggestName(normalized)) {
        siteNameInput.value = metadata.title || suggestName(normalized);
      }
      if (siteDescInput && !siteDescInput.value.trim()) {
        siteDescInput.value = metadata.description || "";
      }
      if (siteThumbUrlInput && !siteThumbUrlInput.value.trim()) {
        siteThumbUrlInput.value = metadata.image || "";
      }
      if (siteFaviconUrlInput && !siteFaviconUrlInput.value.trim()) {
        siteFaviconUrlInput.value = metadata.favicon || "";
      }
      if (siteFolderInput && !siteFolderInput.value.trim()) {
        siteFolderInput.value = DEFAULT_FOLDER_NAME;
      }

      setMetadataPreview(metadata);
      setMetadataHint("Open Graph 정보를 자동 반영했습니다.");
    } catch (_error) {
      if (metadataRequestInFlight !== requestId) {
        return;
      }
      setMetadataHint("메타데이터 자동 추출에 실패했습니다. 필요하면 직접 입력해주세요.");
    } finally {
      if (metadataRequestInFlight === requestId && nextBtn) {
        nextBtn.disabled = false;
      }
    }
  }

  async function extractMetadataForUrl(url) {
    const html = await fetchHtmlWithFallback(url);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = pickFirstMeta(doc, [
      ['meta[property="og:title"]', "content"],
      ['meta[name="twitter:title"]', "content"],
      ["title", "textContent"]
    ]) || suggestName(url);
    const description =
      pickFirstMeta(doc, [
        ['meta[property="og:description"]', "content"],
        ['meta[name="description"]', "content"],
        ['meta[name="twitter:description"]', "content"]
      ]) || "";
    const image = normalizeAssetUrl(
      pickFirstMeta(doc, [
        ['meta[property="og:image"]', "content"],
        ['meta[name="twitter:image"]', "content"]
      ]),
      url
    );
    const favicon = normalizeAssetUrl(
      pickFirstMeta(doc, [
        ['link[rel="icon"]', "href"],
        ['link[rel="shortcut icon"]', "href"],
        ['link[rel="apple-touch-icon"]', "href"]
      ]),
      url
    );

    return {
      title,
      description,
      image,
      favicon,
      domain: extractDomain(url)
    };
  }

  async function fetchHtmlWithFallback(url) {
    const candidates = [];
    if (IS_EXTENSION_CONTEXT) {
      candidates.push(url);
    }
    candidates.push(`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`);
    candidates.push(`https://r.jina.ai/http://${url.replace(/^https?:\/\//i, "")}`);

    let lastError = null;
    for (const endpoint of candidates) {
      try {
        const response = await fetch(endpoint, { method: "GET" });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const text = await response.text();
        if (text && text.length > 80) {
          return text;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("페이지를 불러오지 못했습니다");
  }

  function pickFirstMeta(doc, rules) {
    for (const [selector, attribute] of rules) {
      const element = doc.querySelector(selector);
      if (!element) {
        continue;
      }
      const value =
        attribute === "textContent"
          ? (element.textContent || "").trim()
          : (element.getAttribute(attribute) || "").trim();
      if (value) {
        return value;
      }
    }
    return "";
  }

  async function openReader(id) {
    if (!readerOverlay || !readerTitle || !readerBody || !readerImages || !readerSubline) {
      return;
    }

    const data = getData();
    const item = data.bookmarks.find((bookmark) => bookmark.id === id);
    if (!item) {
      return;
    }

    readerOverlay.hidden = false;
    readerTitle.textContent = item.name || item.url;
    readerSubline.textContent = "본문을 불러오는 중...";
    readerImages.innerHTML = "";
    readerBody.innerHTML = "<p>읽기 모드를 준비하고 있습니다...</p>";
    if (readerOpenOriginal) {
      readerOpenOriginal.href = item.url;
    }

    try {
      const readerData = item.reader || (await extractReaderContent(item.url));
      renderReader(item, readerData);

      if (!item.reader) {
        const index = data.bookmarks.findIndex((bookmark) => bookmark.id === id);
        if (index >= 0) {
          data.bookmarks[index] = normalizeBookmark({
            ...data.bookmarks[index],
            reader: readerData,
            updatedAt: Date.now()
          });
          data.updatedAt = Date.now();
          saveData(data, { touch: false });
          scheduleAutoSync();
        }
      }
    } catch (_error) {
      readerSubline.textContent = "읽기 모드 추출 실패";
      readerBody.innerHTML = "<p>본문 추출에 실패했습니다. 원문 열기를 이용해주세요.</p>";
    }
  }

  function closeReader() {
    if (!readerOverlay) {
      return;
    }
    readerOverlay.hidden = true;
  }

  function renderReader(item, readerData) {
    if (!readerTitle || !readerBody || !readerImages || !readerSubline) {
      return;
    }

    readerTitle.textContent = readerData.title || item.name || item.url;
    readerSubline.textContent = `${extractDomain(item.url)} · ${new Date(
      readerData.extractedAt || Date.now()
    ).toLocaleString()}`;
    readerImages.innerHTML = "";
    readerBody.innerHTML = "";

    (readerData.images || []).forEach((imageUrl) => {
      const image = document.createElement("img");
      image.src = imageUrl;
      image.alt = "";
      image.loading = "lazy";
      readerImages.appendChild(image);
    });

    (readerData.blocks || []).forEach((block) => {
      const p = document.createElement("p");
      p.textContent = block;
      readerBody.appendChild(p);
    });
  }

  async function extractReaderContent(url) {
    const html = await fetchHtmlWithFallback(url);
    const doc = new DOMParser().parseFromString(html, "text/html");

    doc.querySelectorAll("script, style, noscript, header, footer, nav, aside, form").forEach((el) => {
      el.remove();
    });

    const root =
      doc.querySelector("article") ||
      doc.querySelector("main") ||
      doc.querySelector("[role='main']") ||
      doc.body;

    const blocks = Array.from(root.querySelectorAll("p"))
      .map((el) => (el.textContent || "").trim())
      .filter((text) => text.length >= 40)
      .slice(0, 40);

    const images = Array.from(root.querySelectorAll("img"))
      .map((img) => normalizeAssetUrl(img.getAttribute("src") || "", url))
      .filter((src, index, arr) => src && arr.indexOf(src) === index)
      .slice(0, 8);

    return {
      title:
        pickFirstMeta(doc, [
          ['meta[property="og:title"]', "content"],
          ["title", "textContent"]
        ]) || suggestName(url),
      blocks: blocks.length ? blocks : ["본문 텍스트를 충분히 추출하지 못했습니다."],
      images,
      extractedAt: Date.now()
    };
  }

  function saveBookmarkFromSheet() {
    const normalizedUrl = normalizeUrl(siteUrlInput.value.trim());
    let name = siteNameInput.value.trim();
    const folder = normalizeFolderName((siteFolderInput?.value || "").trim());
    const thumbUrl = normalizeAssetUrl(siteThumbUrlInput?.value || "");
    const faviconUrl = normalizeAssetUrl(siteFaviconUrlInput?.value || "");
    const tags = parseTags(siteTagsInput.value);
    const desc = siteDescInput.value.trim();

    if (!normalizedUrl) {
      alert("올바른 URL을 입력해주세요");
      return;
    }

    if (!name) {
      name = suggestName(normalizedUrl);
    }

    const now = Date.now();
    const data = getData();

    if (sheetMode === "add") {
      const exists = data.bookmarks.find((item) => item.url === normalizedUrl);
      if (exists) {
        showToast("이미 저장된 사이트입니다. 수정 화면으로 이동합니다");
        openEdit(exists.id);
        return;
      }

      const newItem = normalizeBookmark({
        id: generateId(),
        url: normalizedUrl,
        name,
        folder,
        thumbUrl,
        faviconUrl,
        tags,
        desc,
        createdAt: now,
        updatedAt: now,
        pinned: false,
        visitCount: 0,
        visitedAt: null,
        domain: extractDomain(normalizedUrl)
      });

      data.bookmarks.push(newItem);
      removeTombstone(data, newItem.id);
      data.updatedAt = now;
      saveData(data, { touch: false });
      scheduleAutoSync();
      showToast("저장했어요");
    } else if (sheetMode === "edit" && editId) {
      const index = data.bookmarks.findIndex((item) => item.id === editId);
      if (index >= 0) {
        const original = data.bookmarks[index];
        data.bookmarks[index] = normalizeBookmark({
          ...original,
          url: normalizedUrl,
          name,
          folder,
          thumbUrl,
          faviconUrl,
          tags,
          desc,
          domain: extractDomain(normalizedUrl),
          updatedAt: now
        });
        removeTombstone(data, editId);
        data.updatedAt = now;
        saveData(data, { touch: false });
        scheduleAutoSync();
        showToast("수정했습니다");
      }
    }

    if (navigator.vibrate) {
      navigator.vibrate(10);
    }

    closeSheet();
    render();
  }

  function deleteBookmark(id) {
    const data = getData();
    const index = data.bookmarks.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }

    const now = Date.now();
    const item = data.bookmarks[index];

    deletedItem = {
      item: { ...item },
      index
    };

    data.bookmarks.splice(index, 1);
    upsertTombstone(data, item.id, now);
    data.updatedAt = now;
    saveData(data, { touch: false });
    scheduleAutoSync();

    render();
    showToast("삭제했습니다", { undo: true });

    if (undoTimeout) {
      clearTimeout(undoTimeout);
    }

    undoTimeout = setTimeout(() => {
      deletedItem = null;
      undoTimeout = null;
    }, 5000);
  }

  function undoDelete() {
    if (!deletedItem) {
      return;
    }

    const data = getData();
    const now = Date.now();
    const restoredItem = normalizeBookmark({
      ...deletedItem.item,
      updatedAt: now
    });

    const index = Math.min(Math.max(deletedItem.index, 0), data.bookmarks.length);
    data.bookmarks.splice(index, 0, restoredItem);
    removeTombstone(data, restoredItem.id);
    data.updatedAt = now;
    saveData(data, { touch: false });
    scheduleAutoSync();

    deletedItem = null;
    if (undoTimeout) {
      clearTimeout(undoTimeout);
      undoTimeout = null;
    }

    render();
    showToast("복원했습니다");
  }

  function updateVisit(id) {
    const data = getData();
    const index = data.bookmarks.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }

    const now = Date.now();
    const item = data.bookmarks[index];

    data.bookmarks[index] = normalizeBookmark({
      ...item,
      visitCount: (item.visitCount || 0) + 1,
      visitedAt: now,
      updatedAt: now
    });

    data.updatedAt = now;
    saveData(data, { touch: false });
    scheduleAutoSync();
    renderBookmarks();

    if (navigator.vibrate) {
      navigator.vibrate(10);
    }
  }

  function togglePin(id) {
    const data = getData();
    const index = data.bookmarks.findIndex((item) => item.id === id);
    if (index < 0) {
      return;
    }

    const now = Date.now();
    const item = data.bookmarks[index];
    data.bookmarks[index] = normalizeBookmark({
      ...item,
      pinned: !item.pinned,
      updatedAt: now
    });

    data.updatedAt = now;
    saveData(data, { touch: false });
    scheduleAutoSync();
    renderBookmarks();
  }

  function showToast(message, options = {}) {
    if (!toastContainer) {
      return;
    }

    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;

    if (options.undo) {
      const button = document.createElement("button");
      button.textContent = "되돌리기";
      button.onclick = () => {
        undoDelete();
        toast.remove();
      };
      toast.appendChild(button);
    }

    toastContainer.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 3000);
  }

  function exportData() {
    const data = getData();
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "bookmarks-backup.json";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
    showToast("백업 파일을 다운로드했어요");
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const imported = JSON.parse(loadEvent.target.result);
        const normalized = normalizeData(imported);

        if (!confirm("기존 데이터를 덮어쓰시겠어요?")) {
          return;
        }

        normalized.updatedAt = Date.now();
        saveData(normalized, { touch: false });
        scheduleAutoSync();
        render();
        showToast("데이터를 복구했어요");
      } catch (_error) {
        alert("백업 파일을 읽지 못했습니다");
      }
    };

    reader.readAsText(file);
    importFileInput.value = "";
  }

  function getBookmarkletCode() {
    const current = new URL(window.location.href);
    current.search = "";
    current.hash = "";

    const base = current.toString();
    const safeBase = JSON.stringify(base);

    return `javascript:(function(){var u=encodeURIComponent(location.href);var t=encodeURIComponent(document.title);window.open(${safeBase}+'?url='+u+'&name='+t,'_blank');})();`;
  }

  function copyBookmarkletCode() {
    const code = getBookmarkletCode();

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(code).then(
        () => {
          showToast("북마클릿 코드가 복사되었어요");
        },
        () => {
          prompt("아래 코드를 복사해 북마클릿으로 저장하세요.", code);
        }
      );
      return;
    }

    prompt("아래 코드를 복사해 북마클릿으로 저장하세요.", code);
  }

  function checkIncomingUrl() {
    if (IS_EXTENSION_CONTEXT) {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("oauth_callback") === "1") {
      return;
    }

    if (!params.has("url")) {
      return;
    }

    const urlParam = params.get("url") || "";
    const nameParam = params.get("name") || "";
    const normalized = normalizeUrl(urlParam);

    if (!normalized) {
      return;
    }

    openAddPrefilled(normalized, nameParam || suggestName(normalized));
    history.replaceState(null, "", window.location.pathname);
  }

  function captureCurrentTabToSheet() {
    if (!IS_EXTENSION_CONTEXT || !chrome.tabs?.query) {
      showToast("현재 탭 추가는 확장프로그램에서만 지원됩니다");
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      const tabUrl = tab?.url || "";

      if (!tabUrl || !normalizeUrl(tabUrl)) {
        showToast("이 탭은 URL을 읽을 수 없습니다");
        return;
      }

      openAddPrefilled(tabUrl, tab?.title || suggestName(tabUrl));
    });
  }
  function parseTags(input) {
    if (!input) {
      return [];
    }

    return input
      .split(/[ ,]+/)
      .map((tag) => tag.trim())
      .filter((tag, index, list) => tag && list.indexOf(tag) === index);
  }

  function normalizeFolderName(value) {
    const folder = String(value || "").trim();
    return folder || DEFAULT_FOLDER_NAME;
  }

  function generateId() {
    return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  }

  function normalizeUrl(url) {
    if (!url) {
      return null;
    }

    try {
      const parsed = new URL(url);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return null;
      }
      return parsed.toString();
    } catch (_error) {
      return null;
    }
  }

  function normalizeAssetUrl(url, baseUrl = "") {
    const raw = String(url || "").trim();
    if (!raw) {
      return "";
    }

    if (/^data:/i.test(raw)) {
      return raw;
    }

    try {
      const parsed = baseUrl ? new URL(raw, baseUrl) : new URL(raw);
      if (!/^https?:$/i.test(parsed.protocol)) {
        return "";
      }
      return parsed.toString();
    } catch (_error) {
      return "";
    }
  }

  function extractDomain(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, "");
    } catch (_error) {
      return "";
    }
  }

  function suggestName(url) {
    const domain = extractDomain(url);
    return domain || "";
  }

  function normalizeBookmark(value) {
    const item = value && typeof value === "object" ? value : {};

    const normalizedUrl = normalizeUrl(String(item.url || "").trim());
    const createdAt = toSafeNumber(item.createdAt, Date.now());
    const updatedAt = toSafeNumber(item.updatedAt, createdAt);
    const readerSource = item.reader && typeof item.reader === "object" ? item.reader : null;
    const readerBlocks = Array.isArray(readerSource?.blocks)
      ? readerSource.blocks.map((block) => String(block || "").trim()).filter((block) => block)
      : [];
    const readerImages = Array.isArray(readerSource?.images)
      ? readerSource.images
          .map((src) => normalizeAssetUrl(String(src || ""), normalizedUrl || ""))
          .filter((src) => src)
      : [];
    const normalizedReader = readerSource
      ? {
          title: String(readerSource.title || item.name || normalizedUrl || ""),
          blocks: readerBlocks.slice(0, 80),
          images: readerImages.slice(0, 12),
          extractedAt: toSafeNumber(readerSource.extractedAt, updatedAt)
        }
      : null;

    return {
      id: String(item.id || generateId()),
      url: normalizedUrl || "",
      name: String(item.name || normalizedUrl || ""),
      folder: normalizeFolderName(item.folder),
      thumbUrl: normalizeAssetUrl(item.thumbUrl, normalizedUrl || ""),
      faviconUrl: normalizeAssetUrl(item.faviconUrl, normalizedUrl || ""),
      tags: parseTags(Array.isArray(item.tags) ? item.tags.join(" ") : String(item.tags || "")),
      desc: String(item.desc || ""),
      createdAt,
      updatedAt,
      pinned: !!item.pinned,
      visitCount: toSafeNumber(item.visitCount, 0),
      visitedAt: item.visitedAt ? toSafeNumber(item.visitedAt, null) : null,
      domain: extractDomain(normalizedUrl || ""),
      reader: normalizedReader
    };
  }

  function normalizeData(raw) {
    let source = raw;

    if (!source || typeof source !== "object") {
      source = {};
    }

    if (Array.isArray(source)) {
      source = {
        version: 1,
        bookmarks: source
      };
    }

    const rawBookmarks = Array.isArray(source.bookmarks) ? source.bookmarks : [];
    const bookmarkMap = new Map();

    rawBookmarks.forEach((entry) => {
      const normalized = normalizeBookmark(entry);
      if (!normalized.url) {
        return;
      }

      const existing = bookmarkMap.get(normalized.id);
      if (!existing || normalized.updatedAt > existing.updatedAt) {
        bookmarkMap.set(normalized.id, normalized);
      }
    });

    const tombstoneMap = new Map();
    const rawTombstones = Array.isArray(source.tombstones) ? source.tombstones : [];

    rawTombstones.forEach((entry) => {
      if (!entry || typeof entry !== "object") {
        return;
      }

      const id = String(entry.id || "").trim();
      if (!id) {
        return;
      }

      const deletedAt = toSafeNumber(entry.deletedAt, Date.now());
      const previous = tombstoneMap.get(id);
      if (!previous || deletedAt > previous.deletedAt) {
        tombstoneMap.set(id, { id, deletedAt });
      }
    });

    const bookmarks = [];
    bookmarkMap.forEach((bookmark) => {
      const tombstone = tombstoneMap.get(bookmark.id);
      if (tombstone && tombstone.deletedAt >= bookmark.updatedAt) {
        return;
      }
      bookmarks.push(bookmark);
    });

    const tombstones = [];
    tombstoneMap.forEach((tombstone) => {
      const bookmark = bookmarkMap.get(tombstone.id);
      if (bookmark && bookmark.updatedAt > tombstone.deletedAt) {
        return;
      }
      tombstones.push(tombstone);
    });

    tombstones.sort((a, b) => b.deletedAt - a.deletedAt);

    return {
      version: 2,
      updatedAt: toSafeNumber(source.updatedAt, Date.now()),
      bookmarks,
      tombstones: tombstones.slice(0, 500)
    };
  }

  function toSafeNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function getData() {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) {
      return normalizeData({ version: 2, bookmarks: [], tombstones: [], updatedAt: Date.now() });
    }

    try {
      return normalizeData(JSON.parse(raw));
    } catch (_error) {
      return normalizeData({ version: 2, bookmarks: [], tombstones: [], updatedAt: Date.now() });
    }
  }

  function saveData(data, options = {}) {
    const touch = options.touch !== false;
    const normalized = normalizeData(data);

    if (touch) {
      normalized.updatedAt = Date.now();
    }

    localStorage.setItem(DATA_KEY, JSON.stringify(normalized));
  }

  function getBookmarks() {
    return getData().bookmarks;
  }

  function upsertTombstone(data, id, deletedAt) {
    const found = data.tombstones.find((item) => item.id === id);
    if (found) {
      found.deletedAt = Math.max(found.deletedAt, deletedAt);
      return;
    }

    data.tombstones.push({ id, deletedAt });
  }

  function removeTombstone(data, id) {
    const index = data.tombstones.findIndex((item) => item.id === id);
    if (index >= 0) {
      data.tombstones.splice(index, 1);
    }
  }

  function mergeData(localData, remoteData) {
    const local = normalizeData(localData);
    const remote = normalizeData(remoteData);

    const localBookmarks = new Map(local.bookmarks.map((item) => [item.id, item]));
    const remoteBookmarks = new Map(remote.bookmarks.map((item) => [item.id, item]));
    const localTombstones = new Map(local.tombstones.map((item) => [item.id, item]));
    const remoteTombstones = new Map(remote.tombstones.map((item) => [item.id, item]));

    const allIds = new Set([
      ...localBookmarks.keys(),
      ...remoteBookmarks.keys(),
      ...localTombstones.keys(),
      ...remoteTombstones.keys()
    ]);

    const merged = {
      version: 2,
      updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0),
      bookmarks: [],
      tombstones: []
    };

    allIds.forEach((id) => {
      const localBookmark = localBookmarks.get(id);
      const remoteBookmark = remoteBookmarks.get(id);
      const localTombstone = localTombstones.get(id);
      const remoteTombstone = remoteTombstones.get(id);

      const winnerBookmark = pickNewerBookmark(localBookmark, remoteBookmark);
      const winnerTombstone = pickNewerTombstone(localTombstone, remoteTombstone);

      const bookmarkTime = winnerBookmark ? winnerBookmark.updatedAt : -1;
      const tombstoneTime = winnerTombstone ? winnerTombstone.deletedAt : -1;

      if (winnerBookmark && bookmarkTime > tombstoneTime) {
        merged.bookmarks.push(winnerBookmark);
      } else if (winnerTombstone) {
        merged.tombstones.push(winnerTombstone);
      }
    });

    merged.tombstones.sort((a, b) => b.deletedAt - a.deletedAt);
    merged.tombstones = merged.tombstones.slice(0, 500);

    return normalizeData(merged);
  }

  function pickNewerBookmark(a, b) {
    if (!a) {
      return b || null;
    }
    if (!b) {
      return a;
    }
    return a.updatedAt >= b.updatedAt ? a : b;
  }

  function pickNewerTombstone(a, b) {
    if (!a) {
      return b || null;
    }
    if (!b) {
      return a;
    }
    return a.deletedAt >= b.deletedAt ? a : b;
  }
  function getGoogleConfig() {
    const raw = localStorage.getItem(GOOGLE_CONFIG_KEY);
    if (!raw) {
      return { clientId: "" };
    }

    try {
      const parsed = JSON.parse(raw);
      return {
        clientId: String(parsed.clientId || "").trim()
      };
    } catch (_error) {
      return { clientId: "" };
    }
  }

  function saveGoogleConfig(clientId) {
    localStorage.setItem(
      GOOGLE_CONFIG_KEY,
      JSON.stringify({
        clientId: clientId.trim()
      })
    );
  }

  function clearGoogleConfig() {
    localStorage.removeItem(GOOGLE_CONFIG_KEY);
  }

  function getStoredGoogleToken() {
    const raw = localStorage.getItem(GOOGLE_TOKEN_KEY);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw);
      const accessToken = String(parsed.accessToken || "").trim();
      const expiresAt = toSafeNumber(parsed.expiresAt, 0);
      if (!accessToken || expiresAt <= Date.now()) {
        return null;
      }
      return {
        accessToken,
        expiresAt
      };
    } catch (_error) {
      return null;
    }
  }

  function saveGoogleToken(accessToken, expiresInSeconds) {
    const safeExpires = Math.max(120, toSafeNumber(expiresInSeconds, 3600));
    const expiresAt = Date.now() + (safeExpires - 60) * 1000;
    localStorage.setItem(
      GOOGLE_TOKEN_KEY,
      JSON.stringify({
        accessToken,
        expiresAt
      })
    );
  }

  function clearGoogleToken() {
    localStorage.removeItem(GOOGLE_TOKEN_KEY);
  }

  async function ensureGoogleToken(options = {}) {
    const interactive = options.interactive !== false;
    const cached = getStoredGoogleToken();
    if (cached) {
      return cached.accessToken;
    }

    const config = getGoogleConfig();
    if (!config.clientId) {
      throw new Error("OAuth 설정에서 Client ID를 먼저 저장해주세요");
    }

    if (!interactive) {
      throw new Error("Google 로그인이 필요합니다. 설정에서 다시 연결해주세요");
    }

    let tokenResponse;
    if (IS_EXTENSION_CONTEXT) {
      tokenResponse = await getTokenForExtension(config.clientId);
    } else {
      tokenResponse = await getTokenForWeb(config.clientId);
    }

    saveGoogleToken(tokenResponse.accessToken, tokenResponse.expiresIn);
    return tokenResponse.accessToken;
  }

  function buildGoogleAuthUrl(clientId, redirectUri, state) {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "token");
    url.searchParams.set("scope", DRIVE_SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    return url.toString();
  }

  function getTokenForExtension(clientId) {
    return new Promise((resolve, reject) => {
      const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
      const state = generateId();
      const authUrl = buildGoogleAuthUrl(clientId, redirectUri, state);

      chrome.identity.launchWebAuthFlow(
        {
          url: authUrl,
          interactive: true
        },
        (redirectedUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!redirectedUrl) {
            reject(new Error("Google 로그인이 취소되었습니다"));
            return;
          }

          let callback;
          try {
            callback = new URL(redirectedUrl);
          } catch (_error) {
            reject(new Error("OAuth 응답을 해석하지 못했습니다"));
            return;
          }

          const hashParams = new URLSearchParams(callback.hash.replace(/^#/, ""));
          if (hashParams.get("state") !== state) {
            reject(new Error("OAuth state가 일치하지 않습니다"));
            return;
          }

          if (hashParams.get("error")) {
            reject(new Error(`Google 로그인 실패: ${hashParams.get("error")}`));
            return;
          }

          const accessToken = hashParams.get("access_token");
          if (!accessToken) {
            reject(new Error("access_token이 없습니다"));
            return;
          }

          resolve({
            accessToken,
            expiresIn: toSafeNumber(hashParams.get("expires_in"), 3600)
          });
        }
      );
    });
  }

  function getTokenForWeb(clientId) {
    if (window.location.protocol === "file:") {
      throw new Error("웹에서 Drive 연동은 file:// 환경에서 동작하지 않습니다. localhost 또는 HTTPS에서 실행해주세요");
    }

    return new Promise((resolve, reject) => {
      const state = generateId();
      const redirect = new URL(window.location.href);
      redirect.search = "";
      redirect.hash = "";
      redirect.searchParams.set("oauth_callback", "1");

      const authUrl = buildGoogleAuthUrl(clientId, redirect.toString(), state);
      const popup = window.open(authUrl, "rememberGoogleOAuth", "width=540,height=720");

      if (!popup) {
        reject(new Error("팝업이 차단되었습니다. 팝업 허용 후 다시 시도해주세요"));
        return;
      }

      let handled = false;
      const timer = setInterval(() => {
        if (popup.closed && !handled) {
          cleanup();
          reject(new Error("Google 로그인이 취소되었습니다"));
        }
      }, 400);

      function cleanup() {
        clearInterval(timer);
        window.removeEventListener("message", onMessage);
      }

      function onMessage(event) {
        if (event.origin !== window.location.origin) {
          return;
        }

        const payload = event.data || {};
        if (payload.source !== "remember-oauth") {
          return;
        }

        const params = new URLSearchParams(String(payload.hash || "").replace(/^#/, ""));
        if (params.get("state") !== state) {
          return;
        }

        handled = true;
        cleanup();

        if (params.get("error")) {
          reject(new Error(`Google 로그인 실패: ${params.get("error")}`));
          return;
        }

        const accessToken = params.get("access_token");
        if (!accessToken) {
          reject(new Error("access_token이 없습니다"));
          return;
        }

        resolve({
          accessToken,
          expiresIn: toSafeNumber(params.get("expires_in"), 3600)
        });
      }

      window.addEventListener("message", onMessage);
    });
  }

  async function driveFetch(url, options = {}, allowRetry = true, authOptions = {}) {
    const accessToken = await ensureGoogleToken(authOptions);
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${accessToken}`);

    const response = await fetch(url, {
      ...options,
      headers
    });

    if (response.status === 401 && allowRetry) {
      clearGoogleToken();
      if (authOptions.interactive === false) {
        throw new Error("Google 로그인이 필요합니다. 설정에서 다시 연결해주세요");
      }
      return driveFetch(url, options, false, authOptions);
    }

    if (!response.ok) {
      const text = await response.text();
      const message = text || `HTTP ${response.status}`;
      throw new Error(`Drive API 오류: ${message}`);
    }

    return response;
  }

  async function findDriveFile(authOptions = {}) {
    const query = encodeURIComponent(
      `name='${DRIVE_FILE_NAME}' and 'appDataFolder' in parents and trashed=false`
    );
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder&fields=files(id,name,modifiedTime)&pageSize=1`;
    const response = await driveFetch(url, { method: "GET" }, true, authOptions);
    const payload = await response.json();
    return payload.files?.[0] || null;
  }

  async function downloadDriveData(fileId, authOptions = {}) {
    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const response = await driveFetch(url, { method: "GET" }, true, authOptions);
    return normalizeData(await response.json());
  }

  async function uploadDriveData(data, fileId, authOptions = {}) {
    const boundary = "rememberBoundary" + Date.now();
    const metadata = fileId
      ? { name: DRIVE_FILE_NAME }
      : { name: DRIVE_FILE_NAME, parents: ["appDataFolder"] };

    const multipartBody =
      `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      `${JSON.stringify(normalizeData(data))}\r\n` +
      `--${boundary}--`;

    const method = fileId ? "PATCH" : "POST";
    const endpoint = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,modifiedTime`
      : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime";

    const response = await driveFetch(
      endpoint,
      {
        method,
        headers: {
          "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body: multipartBody
      },
      true,
      authOptions
    );

    return response.json();
  }

  function isDriveFileMissingError(error) {
    const message = error instanceof Error ? error.message : String(error || "");
    return (
      message.includes("HTTP 404") ||
      message.includes("notFound") ||
      message.includes("File not found")
    );
  }

  function shouldSkipAutoSyncForMassDeletion(localData, remoteData, mergedData) {
    const localCount = Array.isArray(localData?.bookmarks) ? localData.bookmarks.length : 0;
    const remoteCount = Array.isArray(remoteData?.bookmarks) ? remoteData.bookmarks.length : 0;
    const mergedCount = Array.isArray(mergedData?.bookmarks) ? mergedData.bookmarks.length : 0;

    const baseline = Math.max(localCount, remoteCount);
    if (baseline < AUTO_SYNC_MASS_DELETE_MIN_ITEMS) {
      return false;
    }

    const removedFromLocal = localCount - mergedCount;
    const removedFromRemote = remoteCount - mergedCount;
    if (removedFromLocal <= 0 && removedFromRemote <= 0) {
      return false;
    }

    return mergedCount <= Math.floor(baseline * AUTO_SYNC_MASS_DELETE_RATIO);
  }

  async function syncWithDrive(options = {}) {
    const authOptions = {
      interactive: options.interactive !== false
    };
    const safeMode = options.safeMode === true;
    const mode = options.mode === "autoFast" ? "autoFast" : "full";

    if (mode === "autoFast") {
      return syncWithDriveAutoFast(authOptions, safeMode);
    }

    return syncWithDriveFull(authOptions, safeMode);
  }

  async function syncWithDriveAutoFast(authOptions, safeMode) {
    const cache = getDriveSyncCache();
    if (!cache.fileId) {
      return syncWithDriveFull(authOptions, safeMode);
    }

    const local = getData();
    local.updatedAt = Date.now();
    saveData(local, { touch: false });

    try {
      const uploaded = await uploadDriveData(local, cache.fileId, authOptions);
      if (!uploaded?.id) {
        throw new Error("Drive 파일 저장에 실패했습니다");
      }

      saveDriveSyncCache({
        fileId: uploaded.id,
        lastFastSyncAt: Date.now()
      });
      return { skipped: false };
    } catch (error) {
      if (isDriveFileMissingError(error)) {
        clearDriveSyncCache();
        return syncWithDriveFull(authOptions, safeMode);
      }
      throw error;
    }
  }

  async function syncWithDriveFull(authOptions, safeMode) {
    const local = getData();
    const cache = getDriveSyncCache();

    let merged = local;
    let fileId = cache.fileId || "";
    let remoteData = null;

    if (fileId) {
      try {
        remoteData = await downloadDriveData(fileId, authOptions);
      } catch (error) {
        if (isDriveFileMissingError(error)) {
          clearDriveSyncCache();
          fileId = "";
        } else {
          throw error;
        }
      }
    }

    if (!remoteData) {
      const remoteFile = await findDriveFile(authOptions);
      if (remoteFile?.id) {
        fileId = remoteFile.id;
        saveDriveSyncCache({ fileId });
        remoteData = await downloadDriveData(fileId, authOptions);
      }
    }

    if (remoteData) {
      merged = mergeData(local, remoteData);
    }

    if (safeMode && remoteData && shouldSkipAutoSyncForMassDeletion(local, remoteData, merged)) {
      return {
        skipped: true,
        message: "자동 동기화 안전모드: 대량 삭제 가능성이 감지되어 중단했습니다. 설정에서 수동 동기화를 실행해 확인해주세요."
      };
    }

    merged.updatedAt = Date.now();
    saveData(merged, { touch: false });

    const uploaded = await uploadDriveData(merged, fileId || null, authOptions);
    if (!uploaded?.id) {
      throw new Error("Drive 파일 저장에 실패했습니다");
    }

    saveDriveSyncCache({
      fileId: uploaded.id,
      lastFullSyncAt: Date.now(),
      lastFastSyncAt: Date.now()
    });

    return { skipped: false };
  }

  async function uploadLocalToDrive() {
    const local = getData();
    local.updatedAt = Date.now();
    saveData(local, { touch: false });

    const remoteFile = await findDriveFile();
    const uploaded = await uploadDriveData(local, remoteFile?.id || null);

    if (!uploaded?.id) {
      throw new Error("Drive 파일 업로드에 실패했습니다");
    }

    saveDriveSyncCache({
      fileId: uploaded.id,
      lastFastSyncAt: Date.now()
    });
  }

  async function downloadDriveToLocal() {
    const remoteFile = await findDriveFile();
    if (!remoteFile) {
      return false;
    }

    const remoteData = await downloadDriveData(remoteFile.id);
    saveData(remoteData, { touch: false });
    saveDriveSyncCache({
      fileId: remoteFile.id,
      lastFullSyncAt: Date.now(),
      lastFastSyncAt: Date.now()
    });
    return true;
  }
})();
