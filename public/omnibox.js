// One intent router for WAEWEB's public search bars: a query is not a URL.
// This module never fetches, navigates or guesses a .com for ordinary words.
export function classifyOmnibox(value) {
  const input=String(value??"").trim();
  if(!input)return {kind:"empty",value:""};
  if(input.length>2048)return {kind:"invalid",value:input,reason:"too_long"};
  if(/^[a-z][a-z0-9+.-]*:\/\//i.test(input))return {
    kind:"url",value:input
  };
  if(/^[a-z][a-z0-9+.-]*:/i.test(input)&&!/^site:/i.test(input))
    return {kind:"url",value:input};
  // Explicit hostname, optionally with path/port; never reclassify natural
  // language, search operators, emails, queries with spaces or short words.
  if(/^(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(input))
    return {kind:"url",value:input};
  return {kind:"search",value:input};
}
