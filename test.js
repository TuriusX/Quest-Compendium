const percentStr = "88.5";
try {
  percentStr.toFixed(1);
} catch (e) {
  console.log(e.message);
}
