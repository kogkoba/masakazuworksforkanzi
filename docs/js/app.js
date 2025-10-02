const PROBLEM_PATH = "./data/problems.json";
let PROBLEMS = [];

(async function init(){
  PROBLEMS = await fetch(PROBLEM_PATH).then(r=>r.json());
  // ここから先は、前回コードの setProblem/renderUnderlay/イベント登録を流用
})();
