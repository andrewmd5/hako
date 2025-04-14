import { nanoid } from "nanoid";
import {
  decodeVariant,
  HAKO_PROD,
  createHakoRuntime,
  type VMContext,
  type HakoRuntime,
  type MemoryUsage,
  type VMValue,
} from "hakojs";

// Types
interface VMInstance {
  id: string;
  name: string;
  context: VMContext;
  executions: ExecutionResult[];
  createdAt: number;
  lastMemoryUsage?: MemoryUsage;
  previousMemoryUsage?: MemoryUsage;
  executionTimes: number[]; // Store execution times in ms
  lastActivity: number; // Timestamp of last activity
}

interface ExecutionResult {
  id: string;
  code: string;
  output: string;
  error?: string;
  timestamp: number;
  executionTime: number; // execution time in ms
}

interface VMMetrics {
  executionTime: number;
  memoryDetails: MemoryUsage;
}

// WebSocket client tracking
type WebSocketClient = {
  ws: WebSocket;
  subscribedToAll: boolean;
  subscribedToVMs: Set<string>;
};

// VM Manager - Keeps track of all virtual machines
class VMManager {
  public runtime: HakoRuntime;
  private vms: Map<string, VMInstance> = new Map();
  private clients: WebSocketClient[] = [];
  private initialized = false;
  private activityCheckInterval: NodeJS.Timeout | null = null;
  private readonly INACTIVITY_TIMEOUT = 1000; // 5 seconds in milliseconds

  async init() {
    if (this.initialized) return;

    // Initialize Hako with real WASM binary - ONCE for the entire application
    const wasmBinary = decodeVariant(HAKO_PROD);
    this.runtime = await createHakoRuntime({
      wasm: {
        io: {
          stdout: (lines) => {
            if (typeof lines === "string") {
              console.log("[Hako Runtime] stdout:", lines);
            }
          },
          stderr: (lines) => {
            if (typeof lines === "string") {
              console.error("[Hako Runtime] stderr:", lines);
            }
          },
        },
      },
      loader: {
        binary: wasmBinary,
        fetch: fetch,
      },
    });
    // const int = this.runtime.createGasInterruptHandler(500);
    // this.runtime.enableInterruptHandler(int);

    this.initialized = true;
    console.log("Hako Runtime initialized successfully");

    // Start periodic checking for VM inactivity
    this.startActivityCheck();
  }

  // Start checking for inactive VMs to reset execution times
  private startActivityCheck() {
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
    }

    this.activityCheckInterval = setInterval(() => {
      this.checkInactiveVMs();
    }, 1000); // Check every second
  }

  // Check for VMs that have been inactive for more than INACTIVITY_TIMEOUT
  private checkInactiveVMs() {
    const now = Date.now();
    let updatedVMs = false;

    for (const [vmId, vm] of this.vms.entries()) {
      // If VM has been inactive for more than the timeout
      if (now - vm.lastActivity > this.INACTIVITY_TIMEOUT) {
        // Only reset if there are execution times to reset
        if (vm.executionTimes.length > 0) {
          // Reset execution times
          vm.executionTimes = [];
          updatedVMs = true;

          console.log(`Reset execution times for inactive VM: ${vmId}`);

          // Broadcast the update to all clients
          this.broadcastVMDetails(vmId);
        }
      }
    }

    // If we reset any VMs, broadcast the VM list update
    if (updatedVMs) {
      this.broadcastVMList();
    }
  }

  // Register a new WebSocket client
  registerClient(ws: WebSocket): void {
    this.clients.push({
      ws,
      subscribedToAll: false,
      subscribedToVMs: new Set(),
    });
    // Send initial list of VMs
    this.sendVMList(ws);
  }

  // Remove a WebSocket client
  removeClient(ws: WebSocket): void {
    const index = this.clients.findIndex((client) => client.ws === ws);
    if (index !== -1) {
      this.clients.splice(index, 1);
    }
  }

  // Subscribe client to all VMs
  subscribeToAll(ws: WebSocket): void {
    const client = this.clients.find((client) => client.ws === ws);
    if (client) {
      client.subscribedToAll = true;
      // Send data for all VMs
      for (const vm of this.vms.values()) {
        this.sendVMDetails(ws, vm.id);
      }
    }
  }

  // Subscribe client to a specific VM
  subscribeToVM(ws: WebSocket, vmId: string): void {
    const client = this.clients.find((client) => client.ws === ws);
    if (client) {
      client.subscribedToVMs.add(vmId);
      // Send detailed data for this VM
      this.sendVMDetails(ws, vmId);
    }
  }

  // Unsubscribe client from a specific VM
  unsubscribeFromVM(ws: WebSocket, vmId: string): void {
    const client = this.clients.find((client) => client.ws === ws);
    if (client) {
      client.subscribedToVMs.delete(vmId);
    }
  }

  // Send VM list to client
  sendVMList(ws: WebSocket): void {
    const vmList = Array.from(this.vms.values()).map((vm) => ({
      id: vm.id,
      name: vm.name,
      executionCount: vm.executions.length,
      createdAt: vm.createdAt,
      // Include average execution time in the list
      executionTime:
        vm.executionTimes.length > 0
          ? vm.executionTimes.reduce((sum, time) => sum + time, 0) /
            vm.executionTimes.length
          : 0,
    }));
    ws.send(
      JSON.stringify({
        type: "vm_list",
        data: vmList,
      }),
    );
  }

  // Send VM details to client
  sendVMDetails(ws: WebSocket, vmId: string): void {
    const vm = this.vms.get(vmId);
    if (!vm) return;

    // Update memory usage
    this.updateMemoryUsage(vmId);

    // Calculate average execution time
    const avgExecTime =
      vm.executionTimes.length > 0
        ? vm.executionTimes.reduce((sum, time) => sum + time, 0) /
          vm.executionTimes.length
        : 0;

    const vmDetails = {
      id: vm.id,
      name: vm.name,
      executionCount: vm.executions.length,
      executions: vm.executions,
      createdAt: vm.createdAt,
      memoryUsage: vm.lastMemoryUsage,
      executionTime: avgExecTime,
    };

    ws.send(
      JSON.stringify({
        type: "vm_details",
        data: vmDetails,
      }),
    );
  }

  // Broadcast VM details to all subscribed clients
  broadcastVMDetails(vmId: string): void {
    const vm = this.vms.get(vmId);
    if (!vm) return;

    for (const client of this.clients) {
      if (client.subscribedToAll || client.subscribedToVMs.has(vmId)) {
        this.sendVMDetails(client.ws, vmId);
      }
    }
  }

  // Broadcast VM list to all clients
  broadcastVMList(): void {
    for (const client of this.clients) {
      this.sendVMList(client.ws);
    }
  }

  // Broadcast execution result to all subscribed clients
  broadcastExecutionResult(vmId: string, execution: ExecutionResult): void {
    const vm = this.vms.get(vmId);
    if (!vm) return;

    for (const client of this.clients) {
      if (client.subscribedToAll || client.subscribedToVMs.has(vmId)) {
        client.ws.send(
          JSON.stringify({
            type: "execution_result",
            vmId,
            data: execution,
          }),
        );
      }
    }
  }

  async createVM(name = "Unnamed VM"): Promise<string> {
    if (!this.initialized) {
      await this.init();
    }

    // Create a new context from the shared runtime
    const context = this.runtime.createContext();

    // Setup stdout/stderr capture for this VM
    const stdoutCapture: string[] = [];
    const stderrCapture: string[] = [];

    // Enable console.log in the VM
    using consoleObj = context.newObject();
    using log = context.newFunction("log", (message: VMValue) => {
      const msg = message.asString();
      stdoutCapture.push(msg);
      console.log(`[VM ${name}] log:`, msg);
      message.dispose();
      return context.undefined();
    });

    consoleObj.setProperty("log", log);

    const globalObj = context.getGlobalObject();
    globalObj.setProperty("console", consoleObj);

    // Create VM instance
    const id = nanoid();

    // Get initial memory stats
    const memUsage = this.runtime.computeMemoryUsage();

    this.vms.set(id, {
      id,
      name,
      context,
      executions: [],
      createdAt: Date.now(),
      lastMemoryUsage: memUsage,
      previousMemoryUsage: undefined,
      executionTimes: [],
      lastActivity: Date.now(),
    });

    console.log(`Created new VM: ${id} (${name})`);

    // Broadcast VM list update to all clients
    this.broadcastVMList();

    return id;
  }

  updateMemoryUsage(vmId: string): MemoryUsage | undefined {
    const vm = this.vms.get(vmId);
    if (!vm) return undefined;

    try {
      // Store previous memory usage for delta calculations
      vm.previousMemoryUsage = vm.lastMemoryUsage;

      // Get memory usage from runtime for this context
      const memoryUsage = this.runtime.computeMemoryUsage();
      vm.lastMemoryUsage = memoryUsage;

      return memoryUsage;
    } catch (e) {
      console.error(`Error updating memory usage for VM ${vmId}:`, e);
      return undefined;
    }
  }

  async executeCode(vmId: string, code: string): Promise<ExecutionResult> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM with ID ${vmId} not found`);
    }

    const executionId = nanoid();
    let output = "";
    let error: string | undefined = undefined;

    // Measure execution time
    const startTime = performance.now();

    try {
      // Execute the code in this VM's context
      const result = vm.context.evalCode(code);
      if (result.error) {
        // Handle error
        error =
          vm.context.getLastError(result.error)?.message || "Unknown error";
      } else {
        // Get result
        const jsValue = result.unwrap();
        const nativeValue = jsValue.toNativeValue();
        output = JSON.stringify(nativeValue.value, null, 2);
        jsValue.dispose();
        nativeValue.dispose();
      }
      result.dispose();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    const endTime = performance.now();
    const executionTime = endTime - startTime;

    // Update VM metrics
    vm.executionTimes.push(executionTime);

    // Limit the number of execution times we store
    if (vm.executionTimes.length > 10) {
      vm.executionTimes.shift();
    }

    // Update last activity timestamp
    vm.lastActivity = Date.now();

    // Update memory usage after execution
    this.updateMemoryUsage(vmId);

    // Record the execution
    const executionResult: ExecutionResult = {
      id: executionId,
      code,
      output,
      error,
      timestamp: Date.now(),
      executionTime,
    };

    vm.executions.push(executionResult);

    // Execute pending jobs in the runtime
    this.runtime.executePendingJobs();

    // Broadcast execution result to all subscribed clients
    this.broadcastExecutionResult(vmId, executionResult);

    // Broadcast updated VM details
    this.broadcastVMDetails(vmId);

    return executionResult;
  }

  getVM(id: string): VMInstance | undefined {
    return this.vms.get(id);
  }

  listVMs(): VMInstance[] {
    return Array.from(this.vms.values());
  }

  deleteVM(id: string): boolean {
    const vm = this.vms.get(id);
    if (!vm) return false;

    try {
      // Clean up context resources
      vm.context.release();
      this.vms.delete(id);

      // Broadcast VM list update to all clients
      this.broadcastVMList();

      return true;
    } catch (e) {
      console.error(`Error deleting VM ${id}:`, e);
      return false;
    }
  }

  // Clean up all resources when shutting down
  cleanup() {
    // Stop the activity check interval
    if (this.activityCheckInterval) {
      clearInterval(this.activityCheckInterval);
      this.activityCheckInterval = null;
    }

    // Clean up all VM contexts
    for (const vm of this.vms.values()) {
      try {
        vm.context.release();
      } catch (e) {
        console.error(`Error releasing VM context: ${e}`);
      }
    }

    // Clear the VM map
    this.vms.clear();

    // Release the runtime if initialized
    if (this.initialized && this.runtime) {
      try {
        this.runtime.release();
      } catch (e) {
        console.error(`Error releasing Hako runtime: ${e}`);
      }
    }

    this.initialized = false;
  }
}

// Create a VM manager instance
const vmManager = new VMManager();

// Initialize the manager
await vmManager.init();

// Handle process termination gracefully
process.on("SIGINT", () => {
  console.log("Shutting down Hako server...");
  vmManager.cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("Shutting down Hako server...");
  vmManager.cleanup();
  process.exit(0);
});

// Serve the application
Bun.serve({
  port: 3000,
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    // WebSocket connection
    if (path === "/ws") {
      // Upgrade the request to a WebSocket connection
      const success = server.upgrade(req);
      return success
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    }

    // API Endpoints
    if (path.startsWith("/api/")) {
      // VM Management
      if (path === "/api/vms" && req.method === "POST") {
        // Create a new VM
        const body = await req.json();
        const vmId = await vmManager.createVM(body.name);
        return Response.json({ id: vmId });
      }

      if (path === "/api/vms" && req.method === "GET") {
        // List all VMs
        const vms = vmManager.listVMs().map((vm) => ({
          id: vm.id,
          name: vm.name,
          executionCount: vm.executions.length,
          createdAt: vm.createdAt,
        }));
        return Response.json(vms);
      }

      if (path.startsWith("/api/vms/") && req.method === "GET") {
        // Get details for a specific VM
        const vmId = path.split("/")[3];
        if (!vmId) {
          return Response.json({ error: "VM ID is required" }, { status: 400 });
        }
        const vm = vmManager.getVM(vmId);
        if (!vm) {
          return Response.json({ error: "VM not found" }, { status: 404 });
        }

        // Update memory usage
        vmManager.updateMemoryUsage(vmId);

        // Calculate average execution time
        const avgExecTime =
          vm.executionTimes.length > 0
            ? vm.executionTimes.reduce((sum, time) => sum + time, 0) /
              vm.executionTimes.length
            : 0;

        return Response.json({
          id: vm.id,
          name: vm.name,
          executionCount: vm.executions.length,
          executions: vm.executions,
          createdAt: vm.createdAt,
          memoryUsage: vm.lastMemoryUsage,
          executionTime: avgExecTime,
        });
      }

      if (path === "/api/build-info") {
        return Response.json(vmManager.runtime.build);
      }

      if (path.startsWith("/api/vms/") && req.method === "DELETE") {
        // Delete a VM
        const vmId = path.split("/")[3];
        if (!vmId) {
          return Response.json({ error: "VM ID is required" }, { status: 400 });
        }
        const success = vmManager.deleteVM(vmId);
        if (!success) {
          return Response.json(
            { error: "Failed to delete VM" },
            { status: 400 },
          );
        }
        return Response.json({ success: true });
      }

      // Code Execution
      if (
        path.startsWith("/api/vms/") &&
        path.endsWith("/execute") &&
        req.method === "POST"
      ) {
        const vmId = path.split("/")[3];
        if (!vmId) {
          return Response.json({ error: "VM ID is required" }, { status: 400 });
        }
        const body = await req.json();
        if (!body.code) {
          return Response.json({ error: "Code is required" }, { status: 400 });
        }

        try {
          const result = await vmManager.executeCode(vmId, body.code);
          return Response.json(result);
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          return Response.json({ error }, { status: 400 });
        }
      }

      // Default API response
      return Response.json({ error: "Not Found" }, { status: 404 });
    }

    // Serve static files for dashboard
    if (path === "/" || path === "/dashboard") {
      return new Response(await Bun.file("./public/index.html").text(), {
        headers: { "Content-Type": "text/html" },
      });
    }

    if (path === "/styles.css") {
      return new Response(await Bun.file("./public/styles.css").text(), {
        headers: { "Content-Type": "text/css" },
      });
    }

    if (path === "/dashboard.js") {
      return new Response(await Bun.file("./public/dashboard.js").text(), {
        headers: { "Content-Type": "application/javascript" },
      });
    }

    console.log(`Serving static file: ${path}`);
    // Serve font files
    if (path.startsWith("/fonts/") && path.endsWith(".woff2")) {
      return new Response(await Bun.file(`./public${path}`).arrayBuffer(), {
        headers: { "Content-Type": "font/woff2" },
      });
    }

    if (path.startsWith("/fonts/") && path.endsWith(".woff")) {
      return new Response(await Bun.file(`./public${path}`).arrayBuffer(), {
        headers: { "Content-Type": "font/woff" },
      });
    }

    // Default response
    return new Response("Not Found", { status: 404 });
  },

  // WebSocket handlers
  websocket: {
    open(ws) {
      console.log("WebSocket connection opened");
      vmManager.registerClient(ws);
    },
    message(ws, message) {
      try {
        const data = JSON.parse(String(message));
        switch (data.type) {
          case "subscribe_all":
            vmManager.subscribeToAll(ws);
            break;
          case "subscribe_vm":
            if (data.vmId) {
              vmManager.subscribeToVM(ws, data.vmId);
            }
            break;
          case "unsubscribe_vm":
            if (data.vmId) {
              vmManager.unsubscribeFromVM(ws, data.vmId);
            }
            break;
          case "execute_code":
            if (data.vmId && data.code) {
              vmManager.executeCode(data.vmId, data.code);
            }
            break;
          case "create_vm":
            vmManager.createVM(data.name || "Unnamed VM");
            break;
          case "delete_vm":
            if (data.vmId) {
              vmManager.deleteVM(data.vmId);
            }
            break;
          case "get_vm_list":
            vmManager.sendVMList(ws);
            break;
          case "get_vm_details":
            if (data.vmId) {
              vmManager.sendVMDetails(ws, data.vmId);
            }
            break;
        }
      } catch (error) {
        console.error("Error processing WebSocket message:", error);
      }
    },
    close(ws) {
      console.log("WebSocket connection closed");
      vmManager.removeClient(ws);
    },
  },
});

console.log("Hako Demo server running at http://localhost:3000");
