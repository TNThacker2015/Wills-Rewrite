/* eslint-env browser */
console.log("rady!");
const allElem = $("#nav").nextAll();
const allDiv = document.createElement("DIV");
allDiv.setAttribute("style", "margin-left:25%; padding:1px 16px; height:1000px");
document.body.append(allDiv);
allElem.appendTo(allDiv);