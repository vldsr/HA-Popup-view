(() => {
  let debugMode = window.__popupViewDebug === true;
  const log = (...args) => {
    if (debugMode) console.log(...args);
  };
  const TOOL_TITLE = "🎉 Popup View";
  const TOOL_VERSION = "v0.5.7";
  
  console.info(
    `%c${TOOL_TITLE} %c${TOOL_VERSION}`,
    "color: white; background: #7C3AED; font-size: 14px; padding: 4px 10px; border-radius: 6px 0 0 6px; font-weight: bold;",
    "color: white; background: #10B981; font-size: 14px; padding: 4px 8px; border-radius: 0 6px 6px 0; font-weight: bold;"
  );
  log("=== POPUP VIEW SCRIPT LOADING ===");
  class PopupView {
    constructor() {
      const previousInstance = window.__popupViewInstance;
      if (previousInstance && previousInstance !== this && typeof previousInstance.destroy === 'function') {
        previousInstance.destroy();
      }
      log("=== POPUP VIEW CONSTRUCTOR CALLED ===");
      this.sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      this._popupCards = [];
      this._hassUnsubscribe = null;
      this._eventUnsubscribe = null;
      this._cardHelpersPromise = null;
      this._destroyed = false;
      this._activeLoad = null;
      this._popupHistoryActive = false;
      this._popupHistoryHandler = this.handlePopupHistory.bind(this);
      window.addEventListener('popstate', this._popupHistoryHandler);
      this.setupEventListener();
      log("Popup View component loaded");
      window.__popupViewInstance = this;
    }
    handlePopupHistory() {
      const popup = document.querySelector('.subview-popup-overlay');
      if (!popup || !this._popupHistoryActive) {
        return;
      }

      log("Browser Back detected - closing popup");
      this._popupHistoryActive = false;
      const animationSpeed = Number(popup.dataset.animationSpeed) || 300;
      this.closePopup(popup, animationSpeed, true);
    }
    interceptServiceCalls() {
      const originalCallService = this._hass?.callService;
      if (originalCallService && !this._intercepted) {
        this._intercepted = true;
        this._originalCallService = originalCallService;
        this._interceptedCallService = (domain, service, data, target) => {
          if (domain === 'popup_view' && service === 'open') {
            data = { ...data, _session_id: this.sessionId };
          }
          return originalCallService.call(this._hass, domain, service, data, target);
        };
        this._hass.callService = this._interceptedCallService;
      }
    }
    toggleDebugMode(enabled = null) {
      debugMode = enabled !== null ? Boolean(enabled) : !debugMode;
      window.__popupViewDebug = debugMode;
      if (debugMode) {
        log("Popup View Debug Mode: ENABLED");
        log("You can toggle debug mode by calling: window.togglePopupDebug()");
      }
      return debugMode;
    }
    setupHassSubscription(loadContext) {
      if (this._hassUnsubscribe) {
        this._hassUnsubscribe();
        this._hassUnsubscribe = null;
      }
      const haElement = document.querySelector('home-assistant');
      const connection = haElement?.hass?.connection;
      if (!connection || !this.isLoadActive(loadContext)) return;

      let lastHass = haElement.hass;
      let frameId = null;
      let eventUnsubscribe = null;
      let disposed = false;

      const scheduleUpdate = () => {
        if (frameId !== null || disposed) return;
        frameId = requestAnimationFrame(() => {
          frameId = null;
          if (disposed || !this.isLoadActive(loadContext)) return;
          const currentHass = haElement.hass;
          if (currentHass && currentHass !== lastHass) {
            lastHass = currentHass;
            this._hass = currentHass;
            this.updatePopupCards(currentHass, loadContext.cards);
          }
        });
      };

      // Keep state changes immediate. The slow fallback also covers updates
      // to hass that are not accompanied by a state_changed event.
      const fallbackIntervalId = setInterval(scheduleUpdate, 1000);

      Promise.resolve(connection.subscribeEvents(scheduleUpdate, 'state_changed'))
        .then((unsubscribe) => {
          if (disposed || !this.isLoadActive(loadContext)) {
            unsubscribe?.();
            return;
          }
          eventUnsubscribe = unsubscribe;
        })
        .catch((error) => console.error('Popup View: hass subscription failed', error));

      this._hassUnsubscribe = () => {
        disposed = true;
        clearInterval(fallbackIntervalId);
        if (frameId !== null) cancelAnimationFrame(frameId);
        eventUnsubscribe?.();
        log("Hass subscription cleaned up");
      };

      log("Hass subscription set up for reactive updates");
    }
    updatePopupCards(hass, cards = this._popupCards) {
      if (!cards || cards.length === 0) return;

      for (const card of cards) {
        if (card && card.hass !== undefined) {
          card.hass = hass;
        }
      }
      log(`🔄 Updated ${cards.length} cards with new hass state`);
    }
    clearPopupCards() {
      this._popupCards = [];
      if (this._hassUnsubscribe) {
        this._hassUnsubscribe();
        this._hassUnsubscribe = null;
      }
      log("🧹 Cleared popup cards and subscriptions");
    }
    isLoadActive(loadContext) {
      return !this._destroyed && this._activeLoad === loadContext && loadContext?.popup?.isConnected;
    }
    assertLoadActive(loadContext) {
      if (this.isLoadActive(loadContext)) return;
      const error = new Error('Popup loading was cancelled');
      error.name = 'AbortError';
      throw error;
    }
    destroy() {
      this._destroyed = true;
      this._activeLoad = null;
      this.clearPopupCards();
      if (this._eventSetupInterval) clearInterval(this._eventSetupInterval);
      if (this._eventSetupTimeout) clearTimeout(this._eventSetupTimeout);
      this._eventUnsubscribe?.();
      this._eventUnsubscribe = null;
      window.removeEventListener('popstate', this._popupHistoryHandler);
      if (this._hass?.callService === this._interceptedCallService && this._originalCallService) {
        this._hass.callService = this._originalCallService;
      }
    }
    lockPageScroll(popup) {
      const root = document.documentElement;
      popup._pageScrollState = {
        rootOverflow: root.style.overflow,
        rootOverscrollBehavior: root.style.overscrollBehavior,
        bodyOverflow: document.body.style.overflow,
        bodyOverscrollBehavior: document.body.style.overscrollBehavior
      };
      root.style.overflow = 'hidden';
      root.style.overscrollBehavior = 'none';
      document.body.style.overflow = 'hidden';
      document.body.style.overscrollBehavior = 'none';
    }
    restorePageScroll(popup) {
      const state = popup?._pageScrollState;
      if (!state) return;
      const root = document.documentElement;
      root.style.overflow = state.rootOverflow;
      root.style.overscrollBehavior = state.rootOverscrollBehavior;
      document.body.style.overflow = state.bodyOverflow;
      document.body.style.overscrollBehavior = state.bodyOverscrollBehavior;
      delete popup._pageScrollState;
    }
    isolatePopupDragEvents(popup) {
      // Cards handle these events first. Stop them at the popup boundary so
      // dashboard-level drag handlers cannot react to popup interactions.
      const eventTypes = [
        'dragstart', 'drag', 'dragend', 'dragenter', 'dragover', 'dragleave', 'drop',
        'pointerdown', 'pointermove', 'pointerup', 'pointercancel',
        'touchstart', 'touchmove', 'touchend', 'touchcancel'
      ];
      const stopAtPopupBoundary = (event) => event.stopPropagation();
      for (const eventType of eventTypes) {
        popup.addEventListener(eventType, stopAtPopupBoundary);
      }
      popup._cleanupDragIsolation = () => {
        for (const eventType of eventTypes) {
          popup.removeEventListener(eventType, stopAtPopupBoundary);
        }
      };
    }
    matchesTargetDisplay(targetDisplays) {
      log("=== DISPLAY MATCHING START ===");
      log("Target displays:", targetDisplays);
      if (!targetDisplays || targetDisplays.length === 0) {
        log("⌛ No target displays specified");
        return false;
      }
      const normalizedTargets = targetDisplays.map(t => t.toLowerCase().trim());
      log("Normalized targets:", normalizedTargets);
      const hass = document.querySelector('home-assistant')?.hass;
      const userName = hass?.user?.name?.toLowerCase();
      if (!userName) {
        log("❌ No username available, cannot match");
        return false;
      }
      log("Current user:", userName);
      for (const target of normalizedTargets) {
        if (target === `person.${userName}`) {
          log("✅ MATCH: Person entity matches current user!");
          return true;
        }
        if (target.startsWith('notify.mobile_app_')) {
          const deviceName = target.replace('notify.mobile_app_', '');
          if (deviceName.includes(userName) || deviceName.includes(userName.replace('_', ''))) {
            log("✅ MATCH: Mobile app device belongs to current user!");
            return true;
          }
        }
        if (target.includes(userName)) {
          log("✅ MATCH: Target contains current username!");
          return true;
        }
      }
      log("❌ NO MATCH: No targets match current user");
      return false;
    }
    ensureScrollbarStyles() {
      let style = document.getElementById('popup-view-scrollbar-style');
      if (!style) {
        style = document.createElement('style');
        style.id = 'popup-view-scrollbar-style';
        document.head.appendChild(style);
      }
      style.textContent = `
        .subview-popup-overlay > .popup-container {
          height: auto !important;
        }
        .popup-content::-webkit-scrollbar {
          width: 0;
          height: 0;
        }
      `;
    }
    applyThemeToPopup(theme, popupElement) {
      if (!theme) return;
      const haElement = document.querySelector('home-assistant');
      const hass = this._hass || haElement?.hass;
      if (!hass || !popupElement) return;
      const availableThemes = hass.themes?.themes || {};
      const themeConfig = availableThemes[theme];
      if (!themeConfig) {
        console.warn(`Popup View: Theme not found: ${theme}`);
        return;
      }
      const modeName = hass.themes?.darkMode ? 'dark' : 'light';
      const resolvedTheme = themeConfig.modes?.[modeName]
        || themeConfig.modes?.light
        || themeConfig.modes?.dark
        || themeConfig;
      const applyThemesOnElement = haElement?.applyThemesOnElement || hass.applyThemesOnElement;
      if (applyThemesOnElement) {
        try {
          applyThemesOnElement(popupElement, theme, hass.themes?.themes, hass.themes?.darkMode);
        } catch (e) {
          console.warn("Popup View: Failed to apply theme via hass.applyThemesOnElement", e);
        }
      } else {
        popupElement.setAttribute('theme', theme);
        Object.entries(resolvedTheme).forEach(([key, value]) => {
          if (value === null || value === undefined) return;
          popupElement.style.setProperty(`--${key}`, `${value}`);
        });
      }
    }
    closePopup(popup, animationSpeed = 300, fromHistory = false) {
      if (!fromHistory && this._popupHistoryActive) {
        log("Closing popup normally - going back in history");
        this._popupHistoryActive = false;
        history.back();
      }

      if (popup._cleanupAutoClose) {
        popup._cleanupAutoClose();
      }
      if (popup._cleanupEscape) {
        popup._cleanupEscape();
      }
      if (popup._cleanupDragIsolation) {
        popup._cleanupDragIsolation();
      }
      if (popup._settleTransformTimer) {
        clearTimeout(popup._settleTransformTimer);
      }
      if (this._activeLoad?.popup === popup) {
        this._activeLoad = null;
        this.clearPopupCards();
      }
      this.restorePageScroll(popup);
      if (animationSpeed > 0) {
        const container = popup.querySelector('.popup-container');
        if (!popup.style.transition || !popup.style.transition.includes('opacity')) {
          popup.style.transition = `opacity ${animationSpeed}ms cubic-bezier(0.4, 0, 0.2, 1)`;
        }
        popup.style.opacity = '0';
        if (container) {
          const alignment = popup.dataset.alignment || 'bottom';
          if (alignment === 'center') {
            container.style.transform = 'translateY(100vh) scale(0.95)';
            container.style.webkitTransform = 'translateY(100vh) scale(0.95)';
          } else {
            container.style.transform = 'translateY(100vh)';
            container.style.webkitTransform = 'translateY(100vh)';
          }
        }
        setTimeout(() => popup.remove(), animationSpeed);
      } else {
        popup.remove();
      }
    }
    setupEventListener() {
      log("=== SETTING UP EVENT LISTENER ===");
      this._eventSetupInterval = setInterval(() => {
        const hass = document.querySelector('home-assistant')?.hass;
        if (hass?.connection && hass.states) {
          this._hass = hass;
          this.interceptServiceCalls();
          clearInterval(this._eventSetupInterval);
          this._eventSetupInterval = null;
          if (this._eventSetupTimeout) {
            clearTimeout(this._eventSetupTimeout);
            this._eventSetupTimeout = null;
          }
          const subscription = hass.connection.subscribeEvents((event) => {
            log("=== POPUP EVENT RECEIVED ===");
            log("Event data:", event.data);
            const { displays, is_tap_action } = event.data;
            let shouldShowPopup = false;
            let reason = "";
            if (is_tap_action && (!displays || displays.length === 0)) {
              log("📱 TAP ACTION detected without displays");
              if (event.data._session_id && event.data._session_id === this.sessionId) {
                shouldShowPopup = true;
                reason = "Tap action from this device (session match)";
                log("✅ Showing popup for our tap action");
              } else {
                shouldShowPopup = false;
                reason = "Tap action from another device";
                log("⏭️ Skipping popup - not our tap");
              }
            }
            else if (displays && displays.length > 0) {
              log("🎯 TARGETED DISPLAY mode");
              log("Checking if this device matches targets...");
              shouldShowPopup = this.matchesTargetDisplay(displays);
              reason = shouldShowPopup ? "Device matches target displays" : "Device does not match targets";
            }
            else {
              log("📢 BROADCAST mode - no displays specified");
              shouldShowPopup = true;
              reason = "Broadcast to all devices";
            }
            log("=== POPUP DECISION ===");
            log("Should show:", shouldShowPopup);
            log("Reason:", reason);
            if (shouldShowPopup) {
              log("🎉 SHOWING POPUP!");
              const {
                path,
                title = "",
                animation_speed = 300,
                auto_close = 0,
                background_blur = false,
                hide_close_button = false,
                popup_height = 90,
                popup_width = 90,
                alignment = 'bottom',
                transparent_background = false,
                theme = ""
              } = event.data || {};
              this.openPopup(path || "", title || "", {
                animationSpeed: animation_speed ?? 300,
                autoClose: auto_close ?? 0,
                backgroundBlur: background_blur ?? false,
                hideCloseButton: hide_close_button ?? false,
                popupHeight: popup_height ?? 90,
                popupWidth: popup_width ?? 90,
                alignment: alignment || 'bottom',
                transparentBackground: transparent_background ?? false,
                theme: theme || ""
              });
            } else {
              log("⏭️ Skipping popup - not for this device");
            }
            log("=== EVENT HANDLING COMPLETE ===\n");
          }, 'popup_view_open');
          Promise.resolve(subscription)
            .then((unsubscribe) => {
              if (this._destroyed) {
                unsubscribe?.();
                return;
              }
              this._eventUnsubscribe = unsubscribe;
            })
            .catch((error) => console.error('Popup View: event subscription failed', error));
          log("=== POPUP VIEW LISTENING FOR EVENTS ===");
        }
      }, 100);
      this._eventSetupTimeout = setTimeout(() => {
        if (!this._eventSetupInterval) return;
        clearInterval(this._eventSetupInterval);
        this._eventSetupInterval = null;
        console.warn("Popup View: Could not connect to HA after 10 seconds");
      }, 10000);
    }
    async openPopup(subviewPath, popupTitle, options = {}) {
      log("=== OPENING POPUP ===");
      log("Received path:", subviewPath);
      log("Received title:", popupTitle);
      log("Options:", options);

      // Add a dedicated history entry for the popup. Browser/Android Back
      // consumes this entry and fires popstate instead of navigating away.
      if (!this._popupHistoryActive) {
        this._popupHistoryActive = true;
        history.pushState(
          {
            ...history.state,
            popup_view: true
          },
          '',
          location.href
        );
      }

      const {
        animationSpeed = 300,
        autoClose = 0,
        backgroundBlur = false,
        hideCloseButton = false,
        popupHeight = 90,
        popupWidth = 90,
        alignment = 'bottom',
        transparentBackground = false,
        theme = ""
      } = options;
      const existingPopup = document.querySelector('.subview-popup-overlay');
      if (existingPopup) {
        this.closePopup(existingPopup, 0, true);
      }
      const popup = document.createElement('div');
      popup.className = 'subview-popup-overlay';
      popup.dataset.alignment = alignment;
      popup.dataset.animationSpeed = animationSpeed;
      popup.dataset.popupWidth = popupWidth;
      this.lockPageScroll(popup);
      this.isolatePopupDragEvents(popup);
      let overlayAlignment = 'flex-end';
      if (alignment === 'center') {
        overlayAlignment = 'center';
      } else if (alignment === 'top') {
        overlayAlignment = 'flex-start';
      }
      popup.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        ${backgroundBlur ? 'backdrop-filter: blur(4px);' : ''}
        z-index: 7;
        display: flex;
        align-items: ${overlayAlignment};
        justify-content: center;
        opacity: 0;
        transition: opacity ${animationSpeed}ms cubic-bezier(0.4, 0, 0.2, 1);
        touch-action: none;  /* LEGG TIL: Blokkerer touch gestures */
        -webkit-touch-callout: none;  /* LEGG TIL: Disable callout */
        overscroll-behavior: contain;
      `;
      const container = document.createElement('div');
      container.className = 'popup-container';
      let borderRadius = '12px 12px 0 0';
      if (alignment === 'center') {
        borderRadius = '12px';
      } else if (alignment === 'top') {
        borderRadius = '0 0 12px 12px';
      }
      const effectivePopupHeight = popupHeight === 100 ? '100vh' : `${popupHeight}vh`;
      container.style.cssText = `
        width: 600px;
        max-width: ${popupWidth}vw;
        height: auto;  /* ENDRET: Start med auto height */
        min-height: 100px;  /* LEGG TIL: Minimum høyde */
        max-height: ${effectivePopupHeight};
        background: ${transparentBackground ? 'transparent' : 'var(--primary-background-color)'};
        border-radius: ${borderRadius};
        ${transparentBackground ? '' : 'box-shadow: 0 ' + (alignment === 'top' ? '' : '-') + '10px 50px rgba(0, 0, 0, 0.3);'}
        display: flex;
        flex-direction: column;
        overflow: hidden;
        position: relative;
        transform: translateY(100vh);
        -webkit-transform: translateY(100vh);
        transition: transform ${animationSpeed}ms cubic-bezier(0.4, 0, 0.2, 1);
        -webkit-transition: -webkit-transform ${animationSpeed}ms cubic-bezier(0.4, 0, 0.2, 1);
        will-change: transform;
        margin: 0 auto;
        touch-action: auto;
        pointer-events: auto;
      `;
      const closeBtn = hideCloseButton ? null : document.createElement('div');
      if (closeBtn) {
        closeBtn.style.cssText = popupTitle ? `
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border-radius: 50%;
          transition: all 0.2s ease;
          background: var(--card-background-color, var(--ha-card-background));
          box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,0.1));
          margin-left: auto;
        ` : `
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border-radius: 50%;
          transition: all 0.2s ease;
          background: transparent;
          box-shadow: none;
          position: absolute;
          top: 8px;
          right: 8px;
          z-index: 2;
        `;
        const closeIcon = document.createElement('ha-icon');
        closeIcon.setAttribute('icon', 'mdi:close');
        closeIcon.style.cssText = `
          --mdc-icon-size: 24px;
          width: 24px;
          height: 24px;
          color: var(--primary-text-color);
        `;
        closeBtn.appendChild(closeIcon);
        closeBtn.addEventListener('click', () => this.closePopup(popup, animationSpeed));
        closeBtn.addEventListener('mouseenter', () => {
          closeBtn.style.background = 'var(--secondary-background-color)';
          closeBtn.style.transform = 'scale(1.1)';
        });
        closeBtn.addEventListener('mouseleave', () => {
          closeBtn.style.background = 'transparent';
          closeBtn.style.transform = 'scale(1)';
        });
      }
      if (popupTitle) {
        const controls = document.createElement('div');
        controls.className = 'popup-controls';
        controls.style.cssText = `
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 4px 32px;
          background: transparent;
          flex-shrink: 0;
          min-height: 48px;
        `;
        const title = document.createElement('h2');
        title.textContent = popupTitle;
        title.style.cssText = `
          margin: 0;
          font-size: 1.3em;
          font-weight: 500;
          color: var(--primary-text-color);
          background: var(--card-background-color, var(--ha-card-background));
          padding: 4px 16px;
          border-radius: var(--ha-card-border-radius, 12px);
          box-shadow: var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,0.1));
          max-width: calc(100% - 60px);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        `;
        controls.appendChild(title);
        if (closeBtn) {
          controls.appendChild(closeBtn);
        }
        container.appendChild(controls);
      } else if (closeBtn) {
        container.appendChild(closeBtn);
      }
      const content = document.createElement('div');
      content.className = 'popup-content';
      content.style.cssText = `
        flex: 1 1 auto;
        overflow-x: hidden;
        overflow-y: auto;
        padding: 0;
        width: 100%;
        max-width: 100%;
        min-height: 100px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        box-sizing: border-box;
        pointer-events: auto;
        touch-action: manipulation;
        overscroll-behavior: contain;
        scrollbar-width: none;
        -ms-overflow-style: none;
      `;
      content.innerHTML = '<ha-circular-progress active></ha-circular-progress>';
      content.dataset.transparentBackground = transparentBackground;
      container.appendChild(content);
      popup.appendChild(container);
      document.body.appendChild(popup);
      this.ensureScrollbarStyles();
      this.applyThemeToPopup(theme, popup);
      if (animationSpeed > 0) {
        popup.offsetHeight;
        container.offsetHeight;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            popup.style.opacity = '1';
            container.style.transform = 'translateY(0)';
            container.style.webkitTransform = 'translateY(0)';
            popup._settleTransformTimer = setTimeout(() => {
              if (!container.isConnected) return;
              // A transformed ancestor becomes the containing block for
              // position: fixed drag hints. Remove even the zero transform
              // once the opening animation has finished.
              container.style.transform = 'none';
              container.style.webkitTransform = 'none';
              container.style.willChange = 'auto';
            }, animationSpeed);
          });
        });
      } else {
        popup.style.opacity = '1';
        container.style.transform = 'none';
        container.style.webkitTransform = 'none';
        container.style.willChange = 'auto';
      }
      if (autoClose > 0) {
        const idleTimeout = autoClose * 1000;
        let closeTimer = null;
        let lastActivity = Date.now();

        const checkIdle = () => {
          const remaining = idleTimeout - (Date.now() - lastActivity);
          if (remaining > 0) {
            closeTimer = setTimeout(checkIdle, remaining);
            return;
          }
          log("Auto-closing popup after idle timeout");
          this.closePopup(popup, animationSpeed);
        };

        const activityEvents = [
          'mousedown', 'mousemove', 'mouseenter',
          'touchstart', 'touchmove',
          'scroll', 'wheel',
          'keydown', 'click'
        ];
        const handleActivity = (e) => {
          if (popup.contains(e.target)) {
            lastActivity = Date.now();
          }
        };
        activityEvents.forEach(eventType => {
          popup.addEventListener(eventType, handleActivity, { passive: true });
        });
        content.addEventListener('scroll', handleActivity, { passive: true });
        closeTimer = setTimeout(checkIdle, idleTimeout);
        popup._cleanupAutoClose = () => {
          if (closeTimer) {
            clearTimeout(closeTimer);
          }
          activityEvents.forEach(eventType => {
            popup.removeEventListener(eventType, handleActivity);
          });
          content.removeEventListener('scroll', handleActivity);
        };
      }
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          this.closePopup(popup, animationSpeed);
        }
      };
      document.addEventListener('keydown', handleEscape);
      popup._cleanupEscape = () => {
        document.removeEventListener('keydown', handleEscape);
      };
      popup.addEventListener('click', (e) => {
        if (e.target === popup) {
          this.closePopup(popup, animationSpeed);
        }
      });

      this.clearPopupCards();
      const loadContext = { popup, cards: [] };
      this._activeLoad = loadContext;
      this._popupCards = loadContext.cards;

      try {
        await this.loadViewContent(subviewPath, content, loadContext);
        this.assertLoadActive(loadContext);
        this.setupHassSubscription(loadContext);
      } catch (error) {
        if (error.name === 'AbortError' || !this.isLoadActive(loadContext)) return;
        console.error("Error loading view:", error);
        content.innerHTML = `
          <div style="text-align: center; color: var(--error-color); padding: 20px;">
            <ha-icon icon="mdi:alert" style="--mdc-icon-size: 48px;"></ha-icon>
            <p>${error.message}</p>
          </div>
        `;
      }
    }
    async loadViewContent(subviewPath, contentElement, loadContext) {
      const hass = document.querySelector('home-assistant');
      if (!hass) {
        throw new Error('Home Assistant element not found');
      }
      await this.waitForLovelace();
      this.assertLoadActive(loadContext);
      if (subviewPath.startsWith('/')) {
        log("Loading view from path:", subviewPath);
      }
      let pathParts = subviewPath.split('/').filter(p => p);
      log("Original path parts:", pathParts);
      let dashboardUrl = 'lovelace';
      let viewPath = '';
      if (pathParts.length === 1) {
        viewPath = pathParts[0];
      } else if (pathParts.length >= 2) {
        dashboardUrl = pathParts[0];
        viewPath = pathParts[1];
      }
      log("Dashboard:", dashboardUrl);
      log("View path:", viewPath);
      log("Full path received:", subviewPath);
      log(`Attempting to get config for dashboard: ${dashboardUrl}`);
      const lovelaceConfig = await this.getLovelaceConfig(dashboardUrl);
      this.assertLoadActive(loadContext);
      log("Config received:", lovelaceConfig);
      if (!lovelaceConfig) {
        throw new Error(`Could not get configuration for dashboard: ${dashboardUrl}`);
      }
      const views = lovelaceConfig.views || [];
      log(`Found ${views.length} views in dashboard '${dashboardUrl}'`);
      if (debugMode) {
        log("Available views:", views.map((v, index) => ({
          path: v.path,
          title: v.title,
          index
        })));
      }
      let viewConfig = views.find(v => v.path === viewPath);
      if (viewConfig) {
        log("Found view by path match:", viewPath);
      }
      if (!viewConfig) {
        const index = parseInt(viewPath);
        if (!isNaN(index) && views[index]) {
          viewConfig = views[index];
          log(`Found view by index: ${index}`);
        }
      }
      if (!viewConfig) {
        if (viewPath === '' && views[0]) {
          viewConfig = views[0];
        } else {
          const foundView = views.find(v => 
            v.path === viewPath || 
            v.path === `/${viewPath}` ||
            v.title?.toLowerCase() === viewPath.toLowerCase()
          );
          if (foundView) {
            viewConfig = foundView;
            log("Found view with alternative matching:", foundView.path);
          } else {
            console.error("Could not find view. Looking for:", viewPath);
            console.error("Available view paths:", views.map(v => v.path));
            throw new Error(`View '${viewPath}' not found in dashboard '${dashboardUrl}'`);
          }
        }
      }
      if (debugMode) {
        log("Found view config:", JSON.stringify(viewConfig, null, 2));
        log("View config keys:", Object.keys(viewConfig || {}));
      }
      log("Starting to create view element...");
      this.assertLoadActive(loadContext);
      contentElement.innerHTML = '';
      // Reset display style after loading (flex was only for centering spinner)
      contentElement.style.display = 'block';
      contentElement.style.alignItems = 'unset';
      contentElement.style.justifyContent = 'unset';
      await this.createViewElement(viewConfig, contentElement, loadContext);
      this.assertLoadActive(loadContext);
      log("View element created successfully");
    }
    async waitForLovelace(timeout = 5000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const hass = document.querySelector('home-assistant');
        if (hass?.hass?.panels) {
          return true;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw new Error('No dashboard panels found');
    }
    async getLovelaceConfig(dashboardUrl = 'lovelace') {
      const hass = document.querySelector('home-assistant').hass;
      log(`getLovelaceConfig called with dashboardUrl: '${dashboardUrl}'`);

      // First, try to get config from already-loaded frontend (works for all users)
      try {
        const lovelacePanel = document.querySelector('home-assistant')
          ?.shadowRoot?.querySelector('home-assistant-main')
          ?.shadowRoot?.querySelector('ha-panel-lovelace');

        if (lovelacePanel?.lovelace?.config) {
          const currentConfig = lovelacePanel.lovelace.config;
          // Check if this is the dashboard we need
          const currentPath = lovelacePanel.lovelace.urlPath || 'lovelace';
          if (currentPath === dashboardUrl || dashboardUrl === 'lovelace') {
            log("Using config from current Lovelace panel");
            return currentConfig;
          }
        }
      } catch (e) {
        log("Could not get config from frontend, trying WebSocket");
      }

      // Try WebSocket API (may require admin for some dashboards)
      try {
        let response;
        if (dashboardUrl && dashboardUrl !== 'lovelace') {
          log(`Fetching config for custom dashboard: ${dashboardUrl}`);
          response = await hass.connection.sendMessagePromise({
            type: 'lovelace/config',
            url_path: dashboardUrl
          });
        } else {
          log("Fetching default lovelace config");
          response = await hass.connection.sendMessagePromise({
            type: 'lovelace/config'
          });
        }
        log("Config response:", response);
        log("Number of views:", response?.views?.length);
        return response;
      } catch (error) {
        // Check if this is a permission error
        if (error.code === 'unauthorized' || error.message?.includes('unauthorized')) {
          console.error('Popup View: User does not have permission to access this dashboard config.');
          console.error('Tip: Either grant admin access, or make sure the popup is for the currently viewed dashboard.');
          throw new Error(`No permission to access dashboard '${dashboardUrl}'. Try using the current dashboard or ask an admin.`);
        }
        console.error('Could not get Lovelace config:', error);
        throw new Error(`Failed to load configuration for dashboard: ${dashboardUrl}`);
      }
    }
    applyCardMod(element, type, cardModConfig, variables = {}) {
      if (!element || !cardModConfig) return;
      setTimeout(() => {
        const CardMod = customElements.get('card-mod');
        if (typeof CardMod?.applyToElement !== 'function') {
          console.warn('Popup View: card-mod is not loaded; styles were not applied');
          return;
        }
        CardMod.applyToElement(element, type, cardModConfig, variables);
      }, 0);
    }
    applyCardGridOptions(cardElement, cardConfig) {
      if (!cardElement) return;
      const configuredColumns = cardConfig?.grid_options?.columns;
      const numericColumns = Number(configuredColumns);
      const columns = configuredColumns === 'full'
        ? 12
        : Number.isFinite(numericColumns) && numericColumns > 0
          ? Math.min(12, Math.max(1, Math.round(numericColumns)))
          : 12;
      cardElement.style.gridColumn = `span ${columns}`;
      cardElement.style.minWidth = '0';
    }
    setupResponsiveSectionsGrid(sectionsContainer, maxColumns) {
      const updateGrid = () => {
        const width = sectionsContainer.clientWidth;
        const availableColumns = Math.max(
          1,
          Math.min(maxColumns, Math.floor((width + 16) / 296) || 1)
        );
        const gridTemplate = `repeat(${availableColumns}, minmax(0, 1fr))`;
        if (sectionsContainer.style.gridTemplateColumns !== gridTemplate) {
          sectionsContainer.style.gridTemplateColumns = gridTemplate;
        }
        for (const sectionElement of sectionsContainer.children) {
          const requestedSpan = Number(sectionElement.dataset.columnSpan) || 1;
          const gridColumn = `span ${Math.min(requestedSpan, availableColumns)}`;
          if (sectionElement.style.gridColumn !== gridColumn) {
            sectionElement.style.gridColumn = gridColumn;
          }
        }
      };
      const observer = new ResizeObserver(updateGrid);
      observer.observe(sectionsContainer);
      requestAnimationFrame(() => {
        updateGrid();
        const overlay = sectionsContainer.closest('.subview-popup-overlay');
        if (overlay) {
          const originalRemove = overlay.remove;
          overlay.remove = function() {
            observer.disconnect();
            originalRemove.call(this);
          };
        }
      });
    }
    async createViewElement(viewConfig, container, loadContext) {
      const hass = document.querySelector('home-assistant').hass;
      log("Creating view element with config:", viewConfig);
      log("View type:", viewConfig.type);
      log("View has cards:", viewConfig.cards?.length || 0);
      log("View has sections:", viewConfig.sections?.length || 0);
      const viewElement = document.createElement('div');
      viewElement.style.cssText = `
        width: 100%; 
        max-width: 100%;  /* VIKTIG: Forhindre at innhold går utenfor */
        height: auto; 
        box-sizing: border-box;
        overflow-x: hidden;  /* Skjul evt overflow */
      `;
      if (viewConfig.type === 'sections' && viewConfig.sections) {
        log(`Creating sections view with ${viewConfig.sections.length} sections`);
        const sectionsContainer = document.createElement('div');
        const configuredMaxColumns = Number(viewConfig.max_columns);
        const maxColumns = Number.isFinite(configuredMaxColumns) && configuredMaxColumns > 0
          ? Math.max(1, Math.round(configuredMaxColumns))
          : Math.max(1, Math.min(4, viewConfig.sections.length));

        sectionsContainer.style.cssText = `
          display: grid;
          grid-template-columns: repeat(${maxColumns}, minmax(0, 1fr));
          gap: 16px;
          padding: 4px 16px;
          width: 100%;
          max-width: 100%;
          box-sizing: border-box;
        `;
        for (const section of viewConfig.sections) {
          const sectionElement = document.createElement('div');
          const rawColumnSpan = section.column_span === 'full' ? maxColumns : Number(section.column_span);
          const columnSpan = Number.isFinite(rawColumnSpan) && rawColumnSpan > 0
            ? Math.min(maxColumns, Math.max(1, Math.round(rawColumnSpan)))
            : 1;
          sectionElement.dataset.columnSpan = String(columnSpan);
          sectionElement.style.cssText = `
            width: 100%;
            box-sizing: border-box;
            overflow: hidden;
            position: relative;
          `;
          if (section.title) {
            const titleElement = document.createElement('h3');
            titleElement.textContent = section.title;
            titleElement.style.cssText = `
              margin: 0 0 12px 0;
              padding: 4px 16px;
              font-size: 1.2em;
              color: var(--primary-text-color);
              width: 100%;
            `;
            sectionElement.appendChild(titleElement);
          }
          const cardsContainer = document.createElement('div');
          cardsContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(12, minmax(0, 1fr));
            align-items: start;
            gap: 8px;
            width: 100%;
          `;
          if (section.cards && section.cards.length > 0) {
            for (const cardConfig of section.cards) {
              try {
                log("Creating card in section:", cardConfig.type);
                const cardElement = await this.createCard(cardConfig, hass, loadContext);
                this.assertLoadActive(loadContext);
                if (cardElement) {
                  this.applyCardGridOptions(cardElement, cardConfig);
                  cardsContainer.appendChild(cardElement);
                }
              } catch (error) {
                if (error.name === 'AbortError') throw error;
                console.error('Error creating card:', error);
                const errorCard = document.createElement('div');
                errorCard.style.cssText = `
                  background: var(--card-background-color);
                  border-radius: 8px;
                  padding: 4px 16px;
                  border: 2px solid var(--error-color);
                  width: 100%;
                  box-sizing: border-box;
                `;
                errorCard.innerHTML = `
                  <ha-icon icon="mdi:alert" style="color: var(--error-color);"></ha-icon>
                  <span style="color: var(--error-color);">Error loading card: ${error.message}</span>
                `;
                cardsContainer.appendChild(errorCard);
              }
            }
          }
          sectionElement.appendChild(cardsContainer);
          sectionsContainer.appendChild(sectionElement);
          this.applyCardMod(sectionElement, 'section', section.card_mod, { config: section });
        }
        viewElement.appendChild(sectionsContainer);
        this.setupResponsiveSectionsGrid(sectionsContainer, maxColumns);
      }
      else if (viewConfig.cards && viewConfig.cards.length > 0) {
        log(`Creating ${viewConfig.cards.length} cards`);
        const cardsContainer = document.createElement('div');
        if (viewConfig.type === 'masonry' || !viewConfig.type) {
          cardsContainer.style.cssText = `
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));  /* ENDRET: Responsiv med max 100% */
            gap: 8px;
            padding: 16px;
            width: 100%;
            max-width: 100%;
            box-sizing: border-box;
          `;
        } else if (viewConfig.type === 'vertical-stack') {
          cardsContainer.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 8px;
            padding: 16px;
            width: 100%;
            box-sizing: border-box;
          `;
        } else {
          cardsContainer.style.cssText = `
            display: block;
            padding: 16px;
            width: 100%;
            box-sizing: border-box;
          `;
        }
        for (const cardConfig of viewConfig.cards) {
          try {
            log("Creating card:", cardConfig.type);
            const cardElement = await this.createCard(cardConfig, hass, loadContext);
            this.assertLoadActive(loadContext);
            if (cardElement) {
              cardsContainer.appendChild(cardElement);
            }
          } catch (error) {
            if (error.name === 'AbortError') throw error;
            console.error('Error creating card:', error);
            const errorCard = document.createElement('div');
            errorCard.style.cssText = `
              background: var(--card-background-color);
              border-radius: 8px;
              padding: 16px;
              border: 2px solid var(--error-color);
              width: 100%;
              box-sizing: border-box;
            `;
            errorCard.innerHTML = `
              <ha-icon icon="mdi:alert" style="color: var(--error-color);"></ha-icon>
              <span style="color: var(--error-color);">Error loading card: ${error.message}</span>
            `;
            cardsContainer.appendChild(errorCard);
          }
        }
        viewElement.appendChild(cardsContainer);
      } else {
        log("No cards found in view config");
        if (debugMode) {
          log("View config structure:", JSON.stringify(viewConfig, null, 2));
        }
        viewElement.innerHTML = `
          <div style="text-align: center; padding: 40px; color: var(--secondary-text-color);">
            <ha-icon icon="mdi:view-dashboard-outline" style="--mdc-icon-size: 64px;"></ha-icon>
            <p>This view has no cards configured</p>
          </div>
        `;
      }
      container.appendChild(viewElement);
      this.applyCardMod(viewElement, 'view', viewConfig.card_mod, { config: viewConfig });
      this.adjustPopupWidth(viewConfig, container);
      this.observeContentHeight(container);
    }
    observeContentHeight(container) {
      const popupContainer = container.closest('.popup-container');
      if (!popupContainer) return;
      const maxHeightStr = popupContainer.style.maxHeight || '90vh';
      const maxHeightVh = parseInt(maxHeightStr) || 90;
      const overlay = popupContainer.closest('.subview-popup-overlay');

      const updateAvailableHeight = () => {
        const controls = popupContainer.querySelector('.popup-controls');
        const controlsHeight = controls ? controls.offsetHeight : 0;
        const maxAllowedHeight = (window.innerHeight * maxHeightVh) / 100;
        const maxContentHeight = Math.max(0, maxAllowedHeight - controlsHeight);

        // Keep the popup shrink-wrapped around its content. Only the scrolling
        // area is constrained, so it can shrink again after it once overflowed.
        popupContainer.style.setProperty('height', 'auto', 'important');
        container.style.flex = '0 1 auto';
        container.style.minHeight = '0';
        container.style.maxHeight = `${maxContentHeight}px`;
        container.style.overflowY = 'auto';
      };

      updateAvailableHeight();
      window.addEventListener('resize', updateAvailableHeight);

      if (overlay) {
        const originalRemove = overlay.remove;
        overlay.remove = function() {
          window.removeEventListener('resize', updateAvailableHeight);
          originalRemove.call(this);
        };
      }
    }
    adjustPopupWidth(viewConfig, contentContainer) {
      const popupContainer = contentContainer.closest('.popup-container');
      if (!popupContainer) return;
      const overlay = popupContainer.closest('.subview-popup-overlay');
      const popupWidthPercent = parseInt(overlay?.dataset.popupWidth) || 90;
      let optimalWidth = '600px';
      const maxWidth = `${popupWidthPercent}vw`;
      if (viewConfig.type === 'sections' && viewConfig.sections) {
        const sectionCount = viewConfig.sections.length;
        log(`Adjusting width for ${sectionCount} sections`);
        if (sectionCount === 1) {
          optimalWidth = '600px';
        } else if (sectionCount === 2) {
          optimalWidth = '1000px';
        } else if (sectionCount >= 3) {
          optimalWidth = `${sectionCount * 400}px`;
        }
      }
      else if (viewConfig.cards) {
        const cardCount = viewConfig.cards.length;
        if (viewConfig.type === 'vertical-stack') {
          optimalWidth = '600px';
        } else if (cardCount <= 2) {
          optimalWidth = '600px';
        } else if (cardCount <= 4) {
          optimalWidth = '900px';
        } else {
          optimalWidth = '1200px';
        }
      }
      if (viewConfig.max_columns) {
        const columnWidth = 450;
        optimalWidth = `${viewConfig.max_columns * columnWidth}px`;
      }
      if (window.innerWidth < 768) {
        optimalWidth = `${popupWidthPercent}vw`;
      }
      setTimeout(() => {
        popupContainer.style.width = optimalWidth;
        popupContainer.style.maxWidth = maxWidth;
      }, 50);
      log(`Popup width animated from 600px to: ${optimalWidth} (max: ${maxWidth})`);
    }
    async getCardHelpers() {
      if (!window.loadCardHelpers) return null;
      if (!this._cardHelpersPromise) {
        this._cardHelpersPromise = Promise.resolve()
          .then(() => window.loadCardHelpers())
          .then((helpers) => {
            if (!helpers) this._cardHelpersPromise = null;
            return helpers;
          })
          .catch((error) => {
            this._cardHelpersPromise = null;
            throw error;
          });
      }
      return this._cardHelpersPromise;
    }
    async createCard(cardConfig, hass, loadContext) {
      try {
        const helpers = await this.getCardHelpers();

        let el;
        if (helpers?.createCardElement) {
          el = await helpers.createCardElement(cardConfig);
        } else {
          const rawType = (cardConfig.type || 'entities').replace('custom:', '');
          const tag = rawType.startsWith('hui-') ? rawType : `hui-${rawType}-card`;
          el = document.createElement(tag);
          if (el.setConfig) el.setConfig(cardConfig);
        }

        this.assertLoadActive(loadContext);
        el.hass = hass;

        // Register card for reactive updates
        loadContext.cards.push(el);

        // Force update for LitElement-based cards
        if (el.requestUpdate) {
          el.requestUpdate();
        }

        el._navigate = (path) => {
          history.pushState(null, "", path);
          const event = new CustomEvent('location-changed');
          window.dispatchEvent(event);
        };

        if (!el.addEventListener) return el;

        el.addEventListener('hass-more-info', (e) => {
          e.stopPropagation();
          const moreInfoEvent = new CustomEvent('hass-more-info', {
            detail: e.detail,
            bubbles: true,
            composed: true
          });
          document.querySelector('home-assistant').dispatchEvent(moreInfoEvent);
        });

        // Handle action events (used by many custom cards)
        el.addEventListener('ll-custom', (e) => {
          e.stopPropagation();
          if (e.detail?.action) {
            const actionEvent = new CustomEvent('ll-custom', {
              detail: e.detail,
              bubbles: true,
              composed: true
            });
            document.querySelector('home-assistant').dispatchEvent(actionEvent);
          }
        });

        el.style.cssText = `
          display: block;
          width: 100%;
          box-sizing: border-box;
          pointer-events: auto;
        `;
        this.applyCardMod(el, 'card', cardConfig.card_mod, { config: cardConfig });
        return el;
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        console.error('Error creating card:', cardConfig.type, error);
        const errorCard = document.createElement('div');
        errorCard.style.cssText = `
          background: var(--card-background-color);
          border-radius: 8px;
          padding: 16px;
          border: 2px solid var(--error-color);
          width: 100%;
          box-sizing: border-box;
        `;
        errorCard.innerHTML = `
          <ha-icon icon="mdi:alert" style="color: var(--error-color);"></ha-icon>
          <span style="color: var(--error-color);">Error loading ${cardConfig.type || 'card'}: ${error.message}</span>
        `;
        return errorCard;
      }
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => new PopupView());
  } else {
    new PopupView();
  }
  window.togglePopupDebug = () => {
    const popupView = window.__popupViewInstance;
    if (popupView) {
      return popupView.toggleDebugMode();
    }
    return false;
  };
})();
