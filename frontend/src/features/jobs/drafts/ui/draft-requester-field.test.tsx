import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
// Keep the real combobox logic; jsdom cannot position the portaled popup.
vi.mock("@/components/ui/combobox", async (original) => ({...await original<typeof import("@/components/ui/combobox")>(),ComboboxContent:({children}:{children:import("react").ReactNode})=><>{children}</>}));
vi.mock("../requesters/actions",()=>({searchRequestersAction:vi.fn(),createRequesterAction:vi.fn()}));
vi.mock("@/components/feedback/notify",()=>({notifyActionResult:vi.fn()}));
import { searchRequestersAction, createRequesterAction } from "../requesters/actions";
import { notifyActionResult } from "@/components/feedback/notify";
import { DraftRequesterField } from "./draft-requester-field";
const entry={id:"0198f5a2-7c1b-7ddd-9c2e-3f4a5b6c7d8e",kind:"client" as const,name:"Acme"};
const onSelect=vi.fn();
function mount(){return render(<DraftRequesterField requester={{original:null,kind:"client",id:null,name:null,changed:false,notice:null}} onChangeKind={vi.fn()} onSelect={onSelect}/>);}
async function tick(){await act(async()=>{await vi.advanceTimersByTimeAsync(310);});}

it.each([
 ["unauthenticated", "Iniciar sesión", "/empresa/login"],
 ["company_inactive", "Revisar empresa", "/empresa/configuracion"],
] as const)("merges the %s recovery link border and preserves its href", async (reason, name, href) => {
 vi.mocked(searchRequestersAction).mockResolvedValue({ok:false,reason,reference:{}});
 mount();fireEvent.change(screen.getByRole("combobox",{name:"Área o cliente"}),{target:{value:"Ac"}});await tick();
 const link=screen.getByRole("link",{name});
 expect(link).toHaveAttribute("href",href);expect(link).toHaveClass("border-border");expect(link).not.toHaveClass("border-transparent");
});

it("does not search or notify on mount and clears selection only explicitly",async()=>{
 render(<DraftRequesterField requester={{original:{kind:"client",id:entry.id},kind:"client",id:entry.id,name:entry.name,changed:false,notice:null}} onChangeKind={vi.fn()} onSelect={onSelect}/>);
 await tick(); expect(searchRequestersAction).not.toHaveBeenCalled();expect(notifyActionResult).not.toHaveBeenCalled();expect(onSelect).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText("Quitar selección"));expect(onSelect).toHaveBeenCalledWith(null);
});
it("does not create on cancel or offer creation for an exact case-insensitive match",async()=>{
 mount();fireEvent.change(screen.getByRole("combobox",{name:"Área o cliente"}),{target:{value:"ACME"}});await tick();
 expect(screen.queryByRole("option",{name:'Crear "ACME"'})).toBeNull();
 fireEvent.change(screen.getByRole("combobox",{name:"Área o cliente"}),{target:{value:"Nuevo"}});await tick();
 fireEvent.click(screen.getByRole("option",{name:'Crear "Nuevo"'}));fireEvent.click(screen.getByText("Cancelar"));expect(createRequesterAction).not.toHaveBeenCalled();expect(onSelect).not.toHaveBeenCalled();
});
it("ignores stale search responses",async()=>{
 let resolve!: (result: Awaited<ReturnType<typeof searchRequestersAction>>) => void;
 vi.mocked(searchRequestersAction).mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));
 mount();const input=screen.getByRole("combobox",{name:"Área o cliente"});fireEvent.change(input,{target:{value:"Viejo"}});await tick();
 vi.mocked(searchRequestersAction).mockResolvedValue({ok:true,items:[],nextCursor:null});
 fireEvent.change(input,{target:{value:"Nuevo"}});await tick();
 await act(async()=>{resolve({ok:true,items:[entry],nextCursor:"stale"});});
 expect(screen.queryByRole("option",{name:"Acme"})).toBeNull();expect(screen.queryByText("Cargar más")).toBeNull();
});
beforeEach(()=>{vi.resetAllMocks();vi.useFakeTimers();vi.stubGlobal("ResizeObserver",class{observe(){} unobserve(){} disconnect(){}});vi.stubGlobal("matchMedia",vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));vi.mocked(searchRequestersAction).mockResolvedValue({ok:true,items:[entry],nextCursor:"abc"});});
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it("debounces by kind and typed prefix, loads more and selects",async()=>{mount();fireEvent.change(screen.getByRole("combobox",{name:"Área o cliente"}),{target:{value:"Ac"}});expect(searchRequestersAction).not.toHaveBeenCalled();await tick();expect(searchRequestersAction).toHaveBeenLastCalledWith({kind:"client",q:"Ac"});fireEvent.click(screen.getByText("Cargar más"));await act(async()=>{});expect(searchRequestersAction).toHaveBeenLastCalledWith({kind:"client",q:"Ac",cursor:"abc"});fireEvent.click(screen.getByRole("option",{name:"Acme"}));expect(onSelect).toHaveBeenCalledWith(entry);});
it("confirms persistence before creating, then selects confirmed result",async()=>{vi.mocked(searchRequestersAction).mockResolvedValue({ok:true,items:[],nextCursor:null});vi.mocked(createRequesterAction).mockResolvedValue({ok:true,requester:entry});mount();fireEvent.change(screen.getByRole("combobox",{name:"Área o cliente"}),{target:{value:"Acme"}});await tick();fireEvent.click(screen.getByRole("option",{name:'Crear "Acme"'}));expect(createRequesterAction).not.toHaveBeenCalled();expect(screen.getByText("Se agregará al catálogo de tu empresa y quedará disponible aunque canceles este borrador.")).toBeVisible();fireEvent.click(screen.getByText("Crear y seleccionar"));await act(async()=>{});expect(onSelect).toHaveBeenCalledWith(entry);expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({key:"requester",type:"success"}));});
it.each(["already_exists","invalid_name","server_error"] as const)("shows %s without auto-select",async reason=>{vi.mocked(searchRequestersAction).mockResolvedValue({ok:true,items:[],nextCursor:null});vi.mocked(createRequesterAction).mockResolvedValue({ok:false,reason,existing:reason==="already_exists"?entry:undefined,message:reason==="invalid_name"?"Nombre inválido":undefined,reference:{status:reason==="server_error"?500:409}});mount();fireEvent.change(screen.getByRole("combobox",{name:"Área o cliente"}),{target:{value:"Acme"}});await tick();fireEvent.click(screen.getByRole("option",{name:'Crear "Acme"'}));fireEvent.click(screen.getByText("Crear y seleccionar"));await act(async()=>{});expect(onSelect).not.toHaveBeenCalled();if(reason==="already_exists"){fireEvent.click(screen.getByText("Seleccionar existente"));expect(onSelect).toHaveBeenCalledWith(entry);}else if(reason==="invalid_name"){expect(screen.getByText("Nombre inválido")).toBeVisible();expect(screen.getByRole("combobox",{name:"Área o cliente"})).toHaveAttribute("aria-invalid","true");}else{expect(notifyActionResult).toHaveBeenCalledWith(expect.objectContaining({type:"error"}));expect(screen.getByText(/El servidor tuvo un problema\./)).toBeVisible();}});
