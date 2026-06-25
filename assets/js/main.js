const toggle=document.querySelector("[data-menu-toggle]");
const navLinks=document.querySelector("[data-nav-links]");
if(toggle&&navLinks){
  toggle.addEventListener("click",()=>{const open=navLinks.classList.toggle("open");toggle.setAttribute("aria-expanded",String(open));});
  navLinks.querySelectorAll("a").forEach(link=>link.addEventListener("click",()=>{navLinks.classList.remove("open");toggle.setAttribute("aria-expanded","false");}));
}
document.querySelectorAll("[data-faq-button]").forEach(button=>{
  button.addEventListener("click",()=>{const item=button.closest(".faq-item");const open=item.classList.toggle("open");button.setAttribute("aria-expanded",String(open));});
});
const year=document.querySelector("[data-year]"); if(year) year.textContent=new Date().getFullYear();
const form=document.querySelector("[data-contact-form]");
if(form){
  form.addEventListener("submit",(event)=>{
    event.preventDefault();
    const data=new FormData(form);
    const subject=encodeURIComponent("New campaign request for Humanly Review Outreach");
    const body=encodeURIComponent(`Hello Humanly Review Outreach,

I want to request an outreach plan.

Name: ${data.get("name")||""}
Company / Brand: ${data.get("company")||""}
Email: ${data.get("email")||""}
Website / Social Link: ${data.get("website")||""}
Campaign Type: ${data.get("campaignType")||""}
Budget Range: ${data.get("budget")||""}

Campaign Details:
${data.get("message")||""}

Thank you.`);
    window.location.href=`mailto:outreach@humanlyreview.com?subject=${subject}&body=${body}`;
  });
}
