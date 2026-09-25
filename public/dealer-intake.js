(() => {
 const script=document.currentScript;
 const api=new URL('/api/dealer-intake',script.src).href;
 document.querySelectorAll('[data-howl-dealer-intake]').forEach(root=>{
  if(root.dataset.ready)return;root.dataset.ready='true';
  root.innerHTML=`<style>
  .howl-intake{box-sizing:border-box;max-width:820px;margin:0 auto;padding:12px 20px 48px;color:#252525;font:15px/1.6 Arial,Helvetica,sans-serif;text-align:left}.howl-intake *{box-sizing:border-box}.howl-intake form{margin:0}.howl-intake fieldset{border:0;padding:0;margin:0;min-width:0}.howl-intake-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px 24px}.howl-intake label{display:flex;flex-direction:column;gap:7px;font-size:14px;font-weight:600;letter-spacing:0;text-transform:none}.howl-intake label small{font-weight:400;color:#666}.howl-intake input,.howl-intake textarea{width:100%;border:1px solid #c5c5c5;border-radius:4px;background:#fff;color:#252525;padding:13px 14px;font:400 16px/1.5 Arial,Helvetica,sans-serif;box-shadow:none;appearance:auto}.howl-intake textarea{resize:vertical}.howl-intake input:focus-visible,.howl-intake textarea:focus-visible,.howl-intake button:focus-visible{outline:3px solid #d6542a;outline-offset:3px}.howl-intake-wide{grid-column:1/-1}.howl-intake .howl-intake-submit{display:inline-flex;justify-content:center;margin:22px 0 0;padding:15px 28px;border:0;border-radius:4px;background:#c84b20;color:#fff;font:600 15px/1.4 Arial,Helvetica,sans-serif;cursor:pointer;text-transform:none!important}.howl-intake .howl-intake-submit:hover{background:#ab3e18}.howl-intake button:disabled{opacity:.6;cursor:wait}.howl-intake-note{font-size:13px;color:#606060;margin:18px 0 0;max-width:65ch}.howl-intake a{color:inherit;text-decoration:underline}.howl-intake-error{color:#a72b20;border-left:3px solid #a72b20;padding:10px 14px;background:#fff6f3;margin-top:20px}.howl-intake-success{padding:36px 0;border-top:2px solid #d6542a}.howl-intake-success h2{font:600 26px/1.3 Arial,Helvetica,sans-serif;letter-spacing:-.03em;margin:0 0 12px;color:#252525}.howl-intake-success p{margin:0;max-width:55ch}.howl-intake-trap{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden}.howl-intake [hidden]{display:none!important}@media(max-width:600px){.howl-intake-grid{grid-template-columns:1fr;gap:18px}.howl-intake{padding-inline:16px}.howl-intake .howl-intake-submit{width:100%}}
  </style><div class="howl-intake"><form aria-label="Dealer inquiry"><fieldset><div class="howl-intake-grid">
  <label>First name<input name="firstName" autocomplete="given-name" maxlength="100" required></label>
  <label>Last name<input name="lastName" autocomplete="family-name" maxlength="100" required></label>
  <label>Email<input name="email" type="email" autocomplete="email" maxlength="254" required></label>
  <label>Phone<input name="phone" type="tel" autocomplete="tel" maxlength="80" required></label>
  <label>Company name<input name="company" autocomplete="organization" maxlength="200" required></label>
  <label><span>Website <small>(optional)</small></span><input name="website" inputmode="url" autocomplete="url" maxlength="500" placeholder="yourstore.com"></label>
  <label class="howl-intake-wide"><span>Business address <small>(optional)</small></span><input name="address" autocomplete="street-address" maxlength="1000"></label>
  <label class="howl-intake-wide">Tell us about your business<textarea name="message" rows="5" maxlength="5000" required placeholder="What do you sell, who are your customers, and where would HOWL fit?"></textarea></label>
  </div><label class="howl-intake-trap" aria-hidden="true">Leave this field empty<input name="fax" tabindex="-1" autocomplete="off"></label>
  <p class="howl-intake-note">Our team will review your inquiry and contact you using the details above. <a href="https://www.howlcampfires.com/policies/privacy-policy" target="_blank" rel="noopener">Privacy policy</a></p>
  <button class="howl-intake-submit" type="submit">Send dealer inquiry</button></fieldset><div class="howl-intake-error" role="alert" hidden></div></form>
  <div class="howl-intake-success" role="status" tabindex="-1" hidden><h2>Your inquiry is in.</h2><p>Thanks for your interest in carrying HOWL. Our team will review your business details and get in touch.</p></div></div>`;
  const form=root.querySelector('form'),fieldset=root.querySelector('fieldset'),button=root.querySelector('button'),error=root.querySelector('[role=alert]'),success=root.querySelector('[role=status]');
  let busy=false,lastPayload='',requestId='';
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(busy||!form.reportValidity())return;
   const data=Object.fromEntries(new FormData(form));const payload=JSON.stringify(data);
   if(payload!==lastPayload){requestId=crypto.randomUUID();lastPayload=payload;}
   busy=true;fieldset.disabled=true;button.textContent='Sending…';error.hidden=true;
   try{
    const response=await fetch(api,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify({...data,requestId}),signal:AbortSignal.timeout(25000)});
    const result=await response.json();if(!response.ok||result.ok!==true)throw new Error(result.error||'We could not confirm your inquiry. Please try again.');
    form.hidden=true;document.querySelectorAll('[data-dealer-intake-intro]').forEach(intro=>{intro.hidden=true;});document.title='Thank you | HOWL Campfires';success.hidden=false;success.focus();
   }catch(e){error.textContent=e.name==='TimeoutError'||e.name==='TypeError'?'We could not confirm your inquiry. Your details are still here. Please try again; repeat submissions will not create duplicate inquiries.':e.message;error.hidden=false;}
   finally{busy=false;fieldset.disabled=false;button.textContent='Send dealer inquiry';}
  });
 });
})();
