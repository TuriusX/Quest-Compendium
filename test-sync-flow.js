// Simulate the flow
let localTabs = [];
let cloudTabs = [];
let hasDoneInitialCloudLoad = false;
let lastSyncedData = { tabs: '' };

// Desktop user logs in, creates a tab, it uploads.
localTabs = [{ id: 1, name: "test" }];
let currentTabsStr = JSON.stringify(localTabs);
lastSyncedData.tabs = currentTabsStr;
cloudTabs = JSON.parse(currentTabsStr); // Upload to cloud

// Laptop user logs in.
let laptopLocalTabs = [];
let laptopHasDoneInitialCloudLoad = false;
let laptopLastSyncedData = { tabs: '' };

// onSnapshot fires on laptop
let cloudTabsStr = JSON.stringify(cloudTabs || []);
let localTabsStr = JSON.stringify(laptopLocalTabs);

if (!laptopHasDoneInitialCloudLoad || cloudTabsStr !== localTabsStr) {
  laptopLocalTabs = cloudTabs; // setLocalGameTabs
}
laptopLastSyncedData.tabs = cloudTabsStr;
laptopHasDoneInitialCloudLoad = true;

console.log("Laptop tabs after sync:", laptopLocalTabs);

// Laptop user logs out and logs back in
// What happens?
