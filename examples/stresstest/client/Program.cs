using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace HakoStressTester
{
    public class Program
    {
        private static readonly HttpClient _httpClient = new HttpClient();
        private static readonly Random _random = new Random();
        private static readonly string _baseUrl = "http://localhost:3000";
        private static readonly List<string> _testScripts = new List<string>();
        private static readonly List<string> _vmIds = new List<string>();
        private static readonly SemaphoreSlim _semaphore = new SemaphoreSlim(10, 10); 
        private static readonly object _lockObject = new object();
        private static long _totalExecutionsCompleted = 0;
        private static long _totalExecutionsFailed = 0;
        private static DateTime _startTime;
        private static int _sleepBetweenRoundsMs = 60; 

        public static async Task Main(string[] args)
        {
            Console.WriteLine("Hako API Stress Tester");
            Console.WriteLine("======================");

            // Set base URL
            _httpClient.BaseAddress = new Uri(_baseUrl);

            // Get scripts directory path
            string scriptsDir = "scripts";
            if (args.Length > 0 && Directory.Exists(args[0]))
            {
                scriptsDir = args[0];
            }
            else if (!Directory.Exists(scriptsDir))
            {
                Console.WriteLine($"Scripts directory '{scriptsDir}' not found. Creating it...");
                Directory.CreateDirectory(scriptsDir);

                Console.WriteLine("Please add JavaScript test files to this directory and run the program again.");
                Console.WriteLine("Exiting...");
                return;
            }

            // Load test scripts from directory
            await LoadTestScriptsFromDirectory(scriptsDir);

            if (_testScripts.Count == 0)
            {
                Console.WriteLine("No test scripts found in the scripts directory. Exiting...");
                return;
            }

            _startTime = DateTime.Now;
            Console.WriteLine($"Test started at: {_startTime}");

            // Duration of the test in seconds (default 60 seconds)
            int durationSeconds = 60;
            if (args.Length > 1 && int.TryParse(args[1], out int parsedDuration))
            {
                durationSeconds = parsedDuration;
            }
            Console.WriteLine($"Test will run for {durationSeconds} seconds");

            // Number of VMs to create (default 64)
            int vmCount = 64;
            if (args.Length > 2 && int.TryParse(args[2], out int parsedVmCount))
            {
                vmCount = parsedVmCount;
            }
            Console.WriteLine($"Creating {vmCount} VMs");

            // Sleep time between rounds (default 3000 ms)
            if (args.Length > 3 && int.TryParse(args[3], out int parsedSleepTime))
            {
                _sleepBetweenRoundsMs = parsedSleepTime;
            }
            Console.WriteLine($"Will sleep for {_sleepBetweenRoundsMs}ms between test rounds");

            try
            {
                // Create VMs
                await CreateVMs(vmCount);
                Console.WriteLine($"Successfully created {_vmIds.Count} VMs");

                // Start status reporting task
                var reportTask = Task.Run(async () =>
                {
                    while (true)
                    {
                        await Task.Delay(1000);
                        ReportStatus();
                    }
                });

                // Run stress test
                var testTask = RunStressTest(durationSeconds);

                // Wait for test to complete
                await testTask;

                // Final report
                ReportStatus();
                Console.WriteLine("Test completed. Cleaning up VMs...");

                // Clean up VMs
                await CleanupVMs();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Fatal error: {ex.Message}");
                if (ex.InnerException != null)
                {
                    Console.WriteLine($"Inner exception: {ex.InnerException.Message}");
                }

                // Try to clean up VMs on error
                try
                {
                    await CleanupVMs();
                }
                catch
                {
                    Console.WriteLine("Failed to clean up VMs during error handling");
                }
            }

            Console.WriteLine("Stress test completed.");
            Console.WriteLine($"Total executions completed: {_totalExecutionsCompleted}");
            Console.WriteLine($"Total executions failed: {_totalExecutionsFailed}");
            Console.WriteLine($"Test duration: {DateTime.Now - _startTime}");
        }

        private static async Task LoadTestScriptsFromDirectory(string directory)
        {
            Console.WriteLine($"Loading test scripts from directory: {directory}");

            try
            {
                // Get all .js files in the directory
                var jsFiles = Directory.GetFiles(directory, "*.js")
                                     .OrderBy(f => f)
                                     .ToList();

                if (jsFiles.Count == 0)
                {
                    Console.WriteLine("No JavaScript files found in the directory.");
                    return;
                }

                foreach (var file in jsFiles)
                {
                    try
                    {
                        string script = await File.ReadAllTextAsync(file);

                        if (!string.IsNullOrWhiteSpace(script))
                        {
                            lock (_lockObject)
                            {
                                _testScripts.Add(script);
                            }
                            Console.WriteLine($"Loaded script: {Path.GetFileName(file)}");
                        }
                    }
                    catch (Exception ex)
                    {
                        Console.WriteLine($"Error loading script {file}: {ex.Message}");
                    }
                }

                Console.WriteLine($"Successfully loaded {_testScripts.Count} test scripts");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error accessing directory {directory}: {ex.Message}");
            }
        }

        private static void ReportStatus()
        {
            TimeSpan elapsed = DateTime.Now - _startTime;
            double execPerSecond = elapsed.TotalSeconds > 0
                ? _totalExecutionsCompleted / elapsed.TotalSeconds
                : 0;

            Console.WriteLine($"Status: {_totalExecutionsCompleted} successful / {_totalExecutionsFailed} failed " +
                              $"executions ({execPerSecond:F2}/sec) - Running for {elapsed:hh\\:mm\\:ss}");
        }

        private static async Task CreateVMs(int count)
        {
            List<Task<string>> tasks = new List<Task<string>>();

            for (int i = 0; i < count; i++)
            {
                int vmNumber = i + 1;
                string formattedNumber = vmNumber <= 9 ? $"0{vmNumber}" : vmNumber.ToString();
                tasks.Add(CreateVM($"StressTest_VM_{formattedNumber}"));
            }

            await Task.WhenAll(tasks);

            // Add VM IDs to our list
            foreach (var task in tasks)
            {
                string vmId = await task;
                if (!string.IsNullOrEmpty(vmId))
                {
                    lock (_lockObject)
                    {
                        _vmIds.Add(vmId);
                    }
                }
            }
        }

        private static async Task<string> CreateVM(string name)
        {
            try
            {
                await _semaphore.WaitAsync();

                var response = await _httpClient.PostAsJsonAsync("/api/vms", new { name });
                response.EnsureSuccessStatusCode();

                var responseData = await response.Content.ReadFromJsonAsync<JsonElement>();
                return responseData.GetProperty("id").GetString()!;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error creating VM {name}: {ex.Message}");
                return string.Empty;
            }
            finally
            {
                _semaphore.Release();
            }
        }

        private static async Task RunStressTest(int durationSeconds)
        {
            if (_vmIds.Count == 0)
            {
                Console.WriteLine("No VMs available for stress testing.");
                return;
            }

            Console.WriteLine($"Starting stress test with {_vmIds.Count} VMs for {durationSeconds} seconds");

            // Create a cancellation token that will cancel after the specified duration
            var cts = new CancellationTokenSource(TimeSpan.FromSeconds(durationSeconds));
            var cancellationToken = cts.Token;

            // Create a list to track all tasks
            var allTasks = new List<Task>();

            // Start a task for each VM
            foreach (var vmId in _vmIds)
            {
                var vmTask = Task.Run(async () =>
                {
                    try
                    {
                        await ExecuteCodeForVM(vmId, cancellationToken);
                    }
                    catch (Exception ex) when (!(ex is OperationCanceledException))
                    {
                        Console.WriteLine($"Error in VM task for {vmId}: {ex.Message}");
                    }
                }, cancellationToken);

                allTasks.Add(vmTask);
            }

            try
            {
                // Wait for all tasks to complete (either by finishing normally or being canceled)
                await Task.WhenAll(allTasks);
            }
            catch (OperationCanceledException)
            {
                Console.WriteLine("Stress test duration completed, stopping test");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Error waiting for VM tasks: {ex.Message}");
            }
        }

        private static async Task ExecuteCodeForVM(string vmId, CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    // Get a random test script
                    string script = GetRandomTestScript();
                    if (string.IsNullOrEmpty(script))
                    {
                        await Task.Delay(100, cancellationToken);
                        continue;
                    }

                    await _semaphore.WaitAsync(cancellationToken);

                    var response = await _httpClient.PostAsJsonAsync(
                        $"/api/vms/{vmId}/execute",
                        new { code = script },
                        cancellationToken);

                    if (response.IsSuccessStatusCode)
                    {
                        Interlocked.Increment(ref _totalExecutionsCompleted);
                    }
                    else
                    {
                        Interlocked.Increment(ref _totalExecutionsFailed);
                        var errorContent = await response.Content.ReadAsStringAsync(cancellationToken);
                        Console.WriteLine($"Execution failed on VM {vmId}: {errorContent}");
                    }

                    // Sleep after each successful round of testing
                    Console.WriteLine($"VM {vmId} completed a test round, sleeping for {_sleepBetweenRoundsMs}ms");
                    await Task.Delay(_sleepBetweenRoundsMs, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    // Just exit the loop when canceled
                    break;
                }
                catch (Exception ex)
                {
                    Interlocked.Increment(ref _totalExecutionsFailed);
                    Console.WriteLine($"Error executing code on VM {vmId}: {ex.Message}");

                    // Add a small delay to avoid overwhelming the server on errors
                    await Task.Delay(500, cancellationToken);
                }
                finally
                {
                    _semaphore.Release();
                }
            }
        }

        private static async Task CleanupVMs()
        {
            int success = 0;
            int failed = 0;

            // Make a copy of the VMIds list to avoid modification during iteration
            List<string> vmIdsToDelete;
            lock (_lockObject)
            {
                vmIdsToDelete = new List<string>(_vmIds);
            }

            Console.WriteLine($"Deleting {vmIdsToDelete.Count} VMs...");

            foreach (var vmId in vmIdsToDelete)
            {
                try
                {
                    await _semaphore.WaitAsync();

                    var response = await _httpClient.DeleteAsync($"/api/vms/{vmId}");
                    if (response.IsSuccessStatusCode)
                    {
                        success++;
                        lock (_lockObject)
                        {
                            _vmIds.Remove(vmId);
                        }
                    }
                    else
                    {
                        failed++;
                        Console.WriteLine($"Failed to delete VM {vmId}: {response.StatusCode}");
                    }
                }
                catch (Exception ex)
                {
                    failed++;
                    Console.WriteLine($"Error deleting VM {vmId}: {ex.Message}");
                }
                finally
                {
                    _semaphore.Release();
                }
            }

            Console.WriteLine($"VM cleanup complete: {success} deleted, {failed} failed");
        }

        private static string GetRandomTestScript()
        {
            lock (_lockObject)
            {
                if (_testScripts.Count == 0)
                {
                    return string.Empty;
                }
                return _testScripts[_random.Next(_testScripts.Count)];
            }
        }
    }
}