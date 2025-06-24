import chalk from "chalk";
import { EventEmitter } from "events";
import fs from "fs-extra";
import path from "path";
export class StateManager extends EventEmitter {
    currentState;
    config;
    snapshots = [];
    snapshotTimer = null;
    autoSaveTimer = null;
    stateFilePath;
    constructor(config = {}) {
        super();
        this.config = {
            persistState: config.persistState ?? true,
            stateFilePath: config.stateFilePath ?? path.join(process.cwd(), 'state', 'server-state.json'),
            snapshotInterval: config.snapshotInterval ?? 30000, // 30 seconds
            maxSnapshots: config.maxSnapshots ?? 100,
            autoSave: config.autoSave ?? true,
            compressionEnabled: config.compressionEnabled ?? false
        };
        this.stateFilePath = this.config.stateFilePath;
        // Initialize state
        this.currentState = this.createInitialState();
        console.error(chalk.blue(`📊 StateManager initialized with session: ${this.currentState.sessionId}`));
        // Load persisted state if available
        if (this.config.persistState) {
            this.loadPersistedState();
        }
        // Start automatic snapshots
        this.startSnapshotTimer();
        // Start auto-save if enabled
        if (this.config.autoSave) {
            this.startAutoSave();
        }
    }
    createInitialState() {
        return {
            sessionId: this.generateSessionId(),
            startTime: new Date(),
            lastActivity: new Date(),
            connectionState: {
                isConnected: false,
                connectionId: null,
                lastConnected: null,
                lastDisconnected: null,
                reconnectAttempts: 0
            },
            processState: {
                managedProcesses: {},
                lastCleanup: null,
                activeProcessCount: 0
            },
            healthState: {
                lastHealthCheck: null,
                healthScore: 0,
                overallHealth: 'unknown',
                consecutiveFailures: 0
            },
            toolState: {
                lastToolCall: null,
                toolCallCount: 0,
                failedToolCalls: 0,
                activeOperations: []
            },
            errorState: {
                lastError: null,
                errorCount: 0,
                criticalErrors: 0,
                recoveryAttempts: 0
            },
            configuration: {
                comfyuiUrl: 'http://127.0.0.1:8188',
                sandboxPath: 'sandbox/ComfyUI_Sandbox_CUDA126',
                autoRestart: true,
                healthMonitoring: true
            }
        };
    }
    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    updateConnectionState(updates) {
        this.currentState.connectionState = {
            ...this.currentState.connectionState,
            ...updates
        };
        this.currentState.lastActivity = new Date();
        console.error(chalk.blue(`🔗 Connection state updated: ${JSON.stringify(updates)}`));
        this.emit('connectionStateChanged', this.currentState.connectionState);
        this.triggerAutoSave();
    }
    updateProcessState(updates) {
        this.currentState.processState = {
            ...this.currentState.processState,
            ...updates
        };
        this.currentState.lastActivity = new Date();
        console.error(chalk.blue(`🔧 Process state updated`));
        this.emit('processStateChanged', this.currentState.processState);
        this.triggerAutoSave();
    }
    updateHealthState(updates) {
        this.currentState.healthState = {
            ...this.currentState.healthState,
            ...updates
        };
        this.currentState.lastActivity = new Date();
        this.emit('healthStateChanged', this.currentState.healthState);
        this.triggerAutoSave();
    }
    updateToolState(updates) {
        this.currentState.toolState = {
            ...this.currentState.toolState,
            ...updates
        };
        this.currentState.lastActivity = new Date();
        this.emit('toolStateChanged', this.currentState.toolState);
        this.triggerAutoSave();
    }
    updateErrorState(updates) {
        this.currentState.errorState = {
            ...this.currentState.errorState,
            ...updates
        };
        this.currentState.lastActivity = new Date();
        console.error(chalk.red(`❌ Error state updated: ${JSON.stringify(updates)}`));
        this.emit('errorStateChanged', this.currentState.errorState);
        this.triggerAutoSave();
    }
    updateConfiguration(updates) {
        this.currentState.configuration = {
            ...this.currentState.configuration,
            ...updates
        };
        this.currentState.lastActivity = new Date();
        console.error(chalk.blue(`⚙️ Configuration updated: ${JSON.stringify(updates)}`));
        this.emit('configurationChanged', this.currentState.configuration);
        this.triggerAutoSave();
    }
    recordToolCall(toolName, success) {
        this.currentState.toolState.lastToolCall = new Date();
        this.currentState.toolState.toolCallCount++;
        if (!success) {
            this.currentState.toolState.failedToolCalls++;
        }
        this.currentState.lastActivity = new Date();
        this.emit('toolCallRecorded', toolName, success);
        this.triggerAutoSave();
    }
    addActiveOperation(operationId) {
        if (!this.currentState.toolState.activeOperations.includes(operationId)) {
            this.currentState.toolState.activeOperations.push(operationId);
            this.emit('operationStarted', operationId);
        }
    }
    removeActiveOperation(operationId) {
        const index = this.currentState.toolState.activeOperations.indexOf(operationId);
        if (index > -1) {
            this.currentState.toolState.activeOperations.splice(index, 1);
            this.emit('operationCompleted', operationId);
        }
    }
    recordError(error, isCritical = false) {
        this.currentState.errorState.lastError = new Date();
        this.currentState.errorState.errorCount++;
        if (isCritical) {
            this.currentState.errorState.criticalErrors++;
        }
        this.currentState.lastActivity = new Date();
        console.error(chalk.red(`📝 Error recorded: ${error.message} (critical: ${isCritical})`));
        this.emit('errorRecorded', error, isCritical);
        this.triggerAutoSave();
    }
    recordRecoveryAttempt() {
        this.currentState.errorState.recoveryAttempts++;
        this.currentState.lastActivity = new Date();
        console.error(chalk.yellow(`🔄 Recovery attempt recorded (total: ${this.currentState.errorState.recoveryAttempts})`));
        this.emit('recoveryAttempted', this.currentState.errorState.recoveryAttempts);
        this.triggerAutoSave();
    }
    resetState(preserveConfiguration = true) {
        const oldSessionId = this.currentState.sessionId;
        const config = preserveConfiguration ? this.currentState.configuration : undefined;
        this.currentState = this.createInitialState();
        if (config) {
            this.currentState.configuration = config;
        }
        console.error(chalk.yellow(`🔄 State reset: ${oldSessionId} → ${this.currentState.sessionId}`));
        this.emit('stateReset', oldSessionId, this.currentState.sessionId);
        this.triggerAutoSave();
    }
    createSnapshot() {
        const snapshot = {
            timestamp: new Date(),
            state: JSON.parse(JSON.stringify(this.currentState)), // Deep clone
            checksum: this.calculateChecksum(this.currentState)
        };
        this.snapshots.push(snapshot);
        // Limit snapshot history
        if (this.snapshots.length > this.config.maxSnapshots) {
            this.snapshots.shift();
        }
        this.emit('snapshotCreated', snapshot);
        return snapshot;
    }
    calculateChecksum(state) {
        const stateString = JSON.stringify(state);
        let hash = 0;
        for (let i = 0; i < stateString.length; i++) {
            const char = stateString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(16);
    }
    restoreFromSnapshot(snapshotIndex) {
        if (snapshotIndex < 0 || snapshotIndex >= this.snapshots.length) {
            console.error(chalk.red(`❌ Invalid snapshot index: ${snapshotIndex}`));
            return false;
        }
        const snapshot = this.snapshots[snapshotIndex];
        if (!snapshot) {
            console.error(chalk.red(`❌ Snapshot not found at index: ${snapshotIndex}`));
            return false;
        }
        const oldSessionId = this.currentState.sessionId;
        this.currentState = JSON.parse(JSON.stringify(snapshot.state)); // Deep clone
        console.error(chalk.green(`✅ State restored from snapshot (${snapshot.timestamp.toISOString()})`));
        this.emit('stateRestored', oldSessionId, this.currentState.sessionId, snapshot);
        return true;
    }
    startSnapshotTimer() {
        this.snapshotTimer = setInterval(() => {
            this.createSnapshot();
        }, this.config.snapshotInterval);
    }
    startAutoSave() {
        this.autoSaveTimer = setInterval(() => {
            if (this.config.persistState) {
                this.saveState();
            }
        }, 10000); // Auto-save every 10 seconds
    }
    triggerAutoSave() {
        if (this.config.autoSave && this.config.persistState) {
            // Debounced save - only save if no activity for 2 seconds
            if (this.autoSaveTimer) {
                clearTimeout(this.autoSaveTimer);
            }
            this.autoSaveTimer = setTimeout(() => {
                this.saveState();
            }, 2000);
        }
    }
    async saveState() {
        try {
            await fs.ensureDir(path.dirname(this.stateFilePath));
            const stateData = {
                version: '1.0.0',
                timestamp: new Date().toISOString(),
                state: this.currentState,
                snapshots: this.snapshots.slice(-10) // Save last 10 snapshots
            };
            await fs.writeJson(this.stateFilePath, stateData, { spaces: 2 });
            console.error(chalk.green(`💾 State saved to ${this.stateFilePath}`));
            this.emit('stateSaved', this.stateFilePath);
            return true;
        }
        catch (error) {
            console.error(chalk.red(`❌ Failed to save state: ${error}`));
            this.emit('stateSaveError', error);
            return false;
        }
    }
    async loadPersistedState() {
        try {
            if (await fs.pathExists(this.stateFilePath)) {
                const stateData = await fs.readJson(this.stateFilePath);
                if (stateData.state) {
                    // Merge persisted state with current state, preserving session info
                    const persistedState = stateData.state;
                    persistedState.sessionId = this.currentState.sessionId; // Keep new session ID
                    persistedState.startTime = this.currentState.startTime; // Keep new start time
                    this.currentState = persistedState;
                    if (stateData.snapshots) {
                        this.snapshots = stateData.snapshots.map((s) => ({
                            ...s,
                            timestamp: new Date(s.timestamp)
                        }));
                    }
                    console.error(chalk.green(`📂 State loaded from ${this.stateFilePath}`));
                    this.emit('stateLoaded', this.stateFilePath);
                    return true;
                }
            }
        }
        catch (error) {
            console.error(chalk.yellow(`⚠️ Failed to load persisted state: ${error}`));
            this.emit('stateLoadError', error);
        }
        return false;
    }
    getState() {
        return JSON.parse(JSON.stringify(this.currentState)); // Return deep clone
    }
    getSnapshots() {
        return [...this.snapshots]; // Return copy
    }
    getStateMetrics() {
        return {
            sessionId: this.currentState.sessionId,
            uptime: Date.now() - this.currentState.startTime.getTime(),
            lastActivity: this.currentState.lastActivity,
            snapshotCount: this.snapshots.length,
            toolCallCount: this.currentState.toolState.toolCallCount,
            errorCount: this.currentState.errorState.errorCount,
            healthScore: this.currentState.healthState.healthScore,
            isConnected: this.currentState.connectionState.isConnected,
            activeOperations: this.currentState.toolState.activeOperations.length
        };
    }
    destroy() {
        if (this.snapshotTimer) {
            clearInterval(this.snapshotTimer);
        }
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        if (this.config.persistState) {
            this.saveState();
        }
        this.removeAllListeners();
        console.error(chalk.gray(`🗑️ StateManager destroyed`));
    }
}
//# sourceMappingURL=StateManager.js.map