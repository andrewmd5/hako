document.addEventListener("DOMContentLoaded", async () => {
  // DOM Elements
  const vmList = document.getElementById("vm-list");
  const vmRowTemplate = document.getElementById("vm-row-template");
  const terminalHistory = document.getElementById("terminal-history");

  // Stats elements
  const vmCountElement = document.querySelector(".vm-count");
  const totalExecutionsElement = document.querySelector(".total-executions");
  const systemUptimeElement = document.querySelector(".system-uptime");
  const terminalStatsElement = document.querySelector(".terminal-stats");

  const buildVersionElement = document.querySelector(".build-version");
  const buildDateElement = document.querySelector(".build-date");
  const buildLlvmElement = document.querySelector(".build-llvm");
  const buildWasiElement = document.querySelector(".build-wasi");
  const buildFeaturesElement = document.querySelector(".build-features");

  // Cache VM rows by ID
  const vmRows = new Map();

  // Track selected VM
  let selectedVmId = null;

  // Store execution time history
  const executionTimes = new Map();

  // Track last execution timestamp for each VM
  const lastExecutionTime = new Map();

  // Timeout for resetting execution times (5 seconds)
  const EXECUTION_RESET_TIMEOUT = 1000;

  // Define execution time scale (ms)
  const MAX_EXECUTION_TIME = 100;

  // System startup time
  const systemStartTime = Date.now();

  // WebSocket connection
  let socket;
  setupWebSocket();

  await fetchBuildInfo();

  // Update system uptime and check resets every second
  setInterval(() => {
    const uptimeMs = Date.now() - systemStartTime;
    systemUptimeElement.textContent = formatUptime(uptimeMs);
    checkExecutionTimeResets();
  }, 1000);

  // Global keyboard shortcuts
  document.addEventListener("keydown", (event) => {
    // Let inline editor handle its own keys.
    if (
      document.activeElement.tagName === "TEXTAREA" &&
      document.activeElement.classList.contains("vm-editor")
    ) {
      return;
    }

    // If a VM is selected and Enter is pressed, open its inline editor.
    if (selectedVmId && event.key === "Enter") {
      event.preventDefault();
      const vmRow = vmRows.get(selectedVmId);
      if (vmRow) {
        const editorContainer = vmRow.querySelector(".vm-editor-container");
        if (editorContainer && !editorContainer.classList.contains("open")) {
          openEditor(selectedVmId);
        }
      }
      return;
    }

    // Delete selected VM with the Delete key (no confirmation)
    if ((event.key === "Delete" || event.keyCode === 46) && selectedVmId) {
      event.preventDefault();
      deleteVM(selectedVmId);
      return;
    }

    // Global shortcuts: N to create a new VM, arrow keys to navigate, Escape to focus first row.
    switch (event.key) {
      case "n":
      case "N":
        createVM();
        break;
      case "ArrowUp":
      case "ArrowDown":
        navigateVmList(event.key === "ArrowUp" ? -1 : 1);
        break;
      case "Escape":
        if (vmList.firstChild) {
          vmList.firstChild.focus();
        }
        break;
    }
  });

  async function fetchBuildInfo() {
    try {
      const response = await fetch("/api/build-info");
      if (!response.ok) {
        throw new Error(`Failed to fetch build info: ${response.status}`);
      }
      const buildInfo = await response.json();
      buildVersionElement.textContent = buildInfo.version;
      buildDateElement.textContent = buildInfo.buildDate;
      buildLlvmElement.textContent = `${buildInfo.llvm} (v${buildInfo.llvmVersion})`;
      buildWasiElement.textContent = `SDK ${buildInfo.wasiSdkVersion} (libc ${buildInfo.wasiLibc})`;
      buildFeaturesElement.innerHTML = "";
      const features = [];
      for (const key in buildInfo) {
        if (
          (key.startsWith("has") || key.startsWith("is")) &&
          buildInfo[key] === true
        ) {
          const featureName = key
            .replace(/^(is|has)/, "")
            .replace(/([A-Z])/g, " $1")
            .trim();
          features.push(featureName);
        }
      }
      for (const feature of features) {
        const featureTag = document.createElement("span");
        featureTag.className = "feature-tag";
        featureTag.textContent = feature;
        buildFeaturesElement.appendChild(featureTag);
      }
    } catch (error) {
      console.error("Error fetching build info:", error);
      buildVersionElement.textContent = "Error";
      buildDateElement.textContent = "Error";
      buildLlvmElement.textContent = "Error";
      buildWasiElement.textContent = "Error";
    }
  }

  function setupWebSocket() {
    socket = new WebSocket(`ws://${window.location.host}/ws`);
    socket.addEventListener("open", (event) => {
      console.log("Connected to server");
      addSystemMessage("Connected to server");
      socket.send(JSON.stringify({ type: "subscribe_all" }));
      socket.send(JSON.stringify({ type: "get_vm_list" }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      switch (message.type) {
        case "vm_list":
          handleVMList(message.data);
          break;
        case "vm_details":
          handleVMDetails(message.data);
          break;
        case "execution_result":
          handleExecutionResult(message.vmId, message.data);
          break;
      }
    });
    socket.addEventListener("close", (event) => {
      console.log("Connection closed. Reconnecting...");
      addSystemMessage("Connection closed. Reconnecting...");
      setTimeout(setupWebSocket, 1000);
    });
    socket.addEventListener("error", (event) => {
      console.error("WebSocket error:", event);
      addSystemMessage("WebSocket error. Check console for details.");
    });
  }

  function checkExecutionTimeResets() {
    const now = Date.now();
    for (const [vmId, lastTime] of lastExecutionTime.entries()) {
      if (now - lastTime > EXECUTION_RESET_TIMEOUT) {
        resetExecutionTime(vmId);
      }
    }
  }

  function resetExecutionTime(vmId) {
    const vmRow = vmRows.get(vmId);
    if (!vmRow) return;
    executionTimes.set(vmId, []);
    const execBar = vmRow.querySelector(".execution-bar");
    const execTimeElement = vmRow.querySelector(".execution-time");
    execBar.style.width = "0%";
    execTimeElement.textContent = "0.00 ms";
    if (selectedVmId === vmId) {
      terminalStatsElement.textContent = "Last exec: 0.00 ms";
    }
  }

  function handleVMList(vms) {
    const activeVmIds = new Set(vms.map((vm) => vm.id));
    for (const [vmId, element] of vmRows.entries()) {
      if (!activeVmIds.has(vmId)) {
        element.remove();
        vmRows.delete(vmId);
        executionTimes.delete(vmId);
        lastExecutionTime.delete(vmId);
        if (selectedVmId === vmId) {
          selectedVmId = null;
        }
      }
    }
    for (const vm of vms) {
      if (!vmRows.has(vm.id)) {
        socket.send(JSON.stringify({ type: "get_vm_details", vmId: vm.id }));
      }
    }
    vmCountElement.textContent = vms.length;
    const totalExecutions = vms.reduce(
      (sum, vm) => sum + (vm.executionCount || 0),
      0,
    );
    totalExecutionsElement.textContent = totalExecutions;
  }

  function handleVMDetails(vm) {
    if (!executionTimes.has(vm.id)) {
      executionTimes.set(vm.id, []);
    }
    if (!lastExecutionTime.has(vm.id)) {
      lastExecutionTime.set(vm.id, vm.executionCount > 0 ? Date.now() : 0);
    }
    if (vmRows.has(vm.id)) {
      updateVMRow(vm);
    } else {
      createVMRow(vm);
    }
    updateMemoryStats(vm.memoryUsage || {});
  }

  function handleExecutionResult(vmId, execution) {
    const vmRow = vmRows.get(vmId);
    if (!vmRow) return;
    lastExecutionTime.set(vmId, Date.now());
    if (execution.executionTime !== undefined) {
      const times = executionTimes.get(vmId);
      times.push(execution.executionTime);
      if (times.length > 10) {
        times.shift();
      }
      const execBar = vmRow.querySelector(".execution-bar");
      const execTimeElement = vmRow.querySelector(".execution-time");
      const execPercentage = Math.min(
        100,
        (execution.executionTime / MAX_EXECUTION_TIME) * 100,
      );
      execBar.style.width = `${execPercentage}%`;
      execTimeElement.textContent = `${execution.executionTime.toFixed(2)} ms`;
      terminalStatsElement.textContent = `Last exec: ${execution.executionTime.toFixed(2)} ms`;
    }
    const executionCountElement = vmRow.querySelector(".vm-executions");
    const currentCount = Number.parseInt(
      executionCountElement.textContent.split(": ")[1],
    );
    executionCountElement.textContent = `Execs: ${currentCount + 1}`;
    const totalExecs = Number.parseInt(totalExecutionsElement.textContent) + 1;
    totalExecutionsElement.textContent = totalExecs;
    addExecutionToTerminal(
      execution,
      terminalHistory,
      vmRow.querySelector(".vm-name").textContent,
    );
  }

  function createVMRow(vm) {
    const vmRow = vmRowTemplate.content
      .cloneNode(true)
      .querySelector(".vm-row");
    vmRow.dataset.vmId = vm.id;
    vmRow.querySelector(".vm-name").textContent = vm.name;
    vmRow.querySelector(".vm-executions").textContent =
      `Execs: ${vm.executionCount || 0}`;
    const uptimeMs = Date.now() - vm.createdAt;
    vmRow.querySelector(".vm-uptime").textContent = formatUptime(uptimeMs);
    // Set up click on header for selection
    vmRow.querySelector(".vm-row-header").addEventListener("click", () => {
      selectVM(vm.id);
    });
    updateExecutionTimeBar(vmRow, vm);
    vmList.appendChild(vmRow);
    vmRows.set(vm.id, vmRow);
    startUptimeUpdates(vm.id, vm.createdAt);
    if (vmRows.size === 1) {
      selectVM(vm.id);
    }
    addSystemMessage(`VM "${vm.name}" created`);
  }

  function updateVMRow(vm) {
    const vmRow = vmRows.get(vm.id);
    if (!vmRow) return;
    vmRow.querySelector(".vm-executions").textContent =
      `Execs: ${vm.executionCount || 0}`;
    updateExecutionTimeBar(vmRow, vm);
  }

  function updateExecutionTimeBar(vmRow, vm) {
    const execBar = vmRow.querySelector(".execution-bar");
    const execTimeElement = vmRow.querySelector(".execution-time");
    const execTime = vm.executionTime || 0;
    const execPercentage = Math.min(100, (execTime / MAX_EXECUTION_TIME) * 100);
    execBar.style.width = `${execPercentage}%`;
    execTimeElement.textContent = `${execTime.toFixed(2)} ms`;
  }

  function startUptimeUpdates(vmId, createdAt) {
    const updateUptime = () => {
      const vmRow = vmRows.get(vmId);
      if (!vmRow) return;
      const uptimeMs = Date.now() - createdAt;
      vmRow.querySelector(".vm-uptime").textContent = formatUptime(uptimeMs);
    };
    setInterval(updateUptime, 1000);
  }

  function updateMemoryStats(memoryUsage) {
    document.querySelector(".memory-used").textContent = formatBytes(
      memoryUsage.memory_used_size || 0,
    );
    document.querySelector(".memory-limit").textContent =
      memoryUsage.malloc_limit > 0
        ? formatBytes(memoryUsage.malloc_limit)
        : "Unlimited";
    document.querySelector(".memory-count").textContent = (
      memoryUsage.malloc_count || 0
    ).toLocaleString();
    document.querySelector(".object-count").textContent = (
      memoryUsage.obj_count || 0
    ).toLocaleString();
    document.querySelector(".string-count").textContent = (
      memoryUsage.str_count || 0
    ).toLocaleString();
    document.querySelector(".function-count").textContent = (
      (memoryUsage.lepus_func_count || 0) + (memoryUsage.c_func_count || 0)
    ).toLocaleString();
  }

  function addSystemMessage(message) {
    const executionElement = document.createElement("div");
    executionElement.className = "execution";
    const codeElement = document.createElement("div");
    codeElement.className = "execution-code";
    codeElement.textContent = `[System] > ${message}`;
    executionElement.appendChild(codeElement);
    terminalHistory.appendChild(executionElement);
    terminalHistory.scrollTop = terminalHistory.scrollHeight;
  }

  function addExecutionToTerminal(execution, terminalElement, vmName) {
    const executionElement = document.createElement("div");
    executionElement.className = "execution";
    executionElement.dataset.executionId = execution.id;
    const timestamp = new Date(execution.timestamp).toLocaleTimeString();
    const codeElement = document.createElement("div");
    codeElement.className = "execution-code";
    codeElement.textContent = `[${timestamp}] [${vmName}] > ${execution.code}`;
    if (execution.executionTime !== undefined) {
      codeElement.textContent += ` (${execution.executionTime.toFixed(2)}ms)`;
    }
    executionElement.appendChild(codeElement);
    if (execution.error) {
      const errorElement = document.createElement("div");
      errorElement.className = "execution-error";
      errorElement.textContent = `Error: ${execution.error}`;
      executionElement.appendChild(errorElement);
    } else {
      const resultElement = document.createElement("div");
      resultElement.className = "execution-result";
      resultElement.textContent = execution.output;
      executionElement.appendChild(resultElement);
    }
    terminalElement.appendChild(executionElement);
    terminalHistory.scrollTop = terminalHistory.scrollHeight;
  }

  function selectVM(vmId) {
    if (selectedVmId && vmRows.has(selectedVmId)) {
      vmRows.get(selectedVmId).classList.remove("selected");
      collapseEditor(selectedVmId);
    }
    if (vmId && vmRows.has(vmId)) {
      vmRows.get(vmId).classList.add("selected");
      selectedVmId = vmId;
      vmRows.get(vmId).querySelector(".vm-row-header").focus();
    } else {
      selectedVmId = null;
    }
  }

  function navigateVmList(direction) {
    if (vmRows.size === 0) return;
    if (!selectedVmId) {
      selectVM(vmRows.keys().next().value);
      return;
    }
    const vmIds = Array.from(vmRows.keys());
    const currentIndex = vmIds.indexOf(selectedVmId);
    const newIndex = (currentIndex + direction + vmIds.length) % vmIds.length;
    selectVM(vmIds[newIndex]);
    const vmRow = vmRows.get(vmIds[newIndex]);
    vmRow.scrollIntoView({ block: "nearest" });
  }

  function executeJsCustom(vmId, code) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected");
      addSystemMessage("Error: WebSocket not connected");
      return;
    }
    socket.send(
      JSON.stringify({
        type: "execute_code",
        vmId,
        code,
      }),
    );
  }

  // Open the inline editor (accordion drawer)
  function openEditor(vmId) {
    const vmRow = vmRows.get(vmId);
    if (!vmRow) return;
    const editorContainer = vmRow.querySelector(".vm-editor-container");
    if (editorContainer) {
      editorContainer.classList.add("open");
      const textarea = editorContainer.querySelector(".vm-editor");
      textarea.focus();
      textarea.onkeydown = (e) => {
        if ((e.key === "Enter" || e.keyCode === 13) && !e.shiftKey) {
          e.preventDefault();
          const code = textarea.value.trim();
          if (code) {
            executeJsCustom(vmId, code);
          }
          collapseEditor(vmId);
        } else if (e.key === "Escape" || e.keyCode === 27) {
          e.preventDefault();
          collapseEditor(vmId);
        }
      };
    }
  }

  // Collapse the inline editor and restore focus to the VM row header
  function collapseEditor(vmId) {
    const vmRow = vmRows.get(vmId);
    if (!vmRow) return;
    const editorContainer = vmRow.querySelector(".vm-editor-container");
    if (editorContainer) {
      const textarea = editorContainer.querySelector(".vm-editor");
      textarea.value = "";
      editorContainer.classList.remove("open");
      vmRow.querySelector(".vm-row-header").focus();
    }
  }

  // Create a new VM automatically without prompting for a name.
  function createVM() {
    // Create a name based on the current timestamp.
    const name = `VM-${Date.now()}`;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected");
      addSystemMessage("Error: WebSocket not connected");
      return;
    }
    socket.send(
      JSON.stringify({
        type: "create_vm",
        name,
      }),
    );
  }

  // Delete a VM immediately without confirmation.
  function deleteVM(vmId) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("WebSocket not connected");
      addSystemMessage("Error: WebSocket not connected");
      return;
    }
    socket.send(
      JSON.stringify({
        type: "delete_vm",
        vmId,
      }),
    );
    addSystemMessage(`Deleting VM ${vmId}...`);
  }

  function formatBytes(bytes) {
    if (bytes === 0 || bytes === undefined) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${Number.parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
  }

  function formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }
});
