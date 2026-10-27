import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canExportCustomers, getBulkCustomerTransferTargets, getCustomerScopeFilter, getVisibleSellerIds } from "@/lib/authz";
import { formatCnpjOrCpf, formatPhone, formatDate } from "@/lib/format";
import { StatusBadge, TemperatureBadge } from "@/components/badges";
import {
  buildCustomerListWhere,
  CustomerFilterForbiddenError,
  customerFiltersToSearchParams,
  parseCustomerListFilters,
} from "@/lib/customer-list";
import { STATUS_LABELS, TEMPERATURE_LABELS } from "@/lib/labels";
import type { CustomerStatus, Temperature } from "@prisma/client";
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPE_VALUES, CUSTOMER_INTEREST_LABELS, CUSTOMER_INTEREST_VALUES, INTERESTED_BRAND_LABELS, INTERESTED_BRAND_VALUES } from "@/lib/customer-fields";
import { BulkTransferControls } from "./bulk-transfer-controls";
import { PipelineBoard } from "./pipeline-board";
import { loadPipelineBoard } from "@/lib/pipeline-board";
import { applyDueStageReturns } from "@/lib/pipeline";
import { attemptStars, FOLLOW_UP_BUCKET_LABELS, PIPELINE_STAGES, PIPELINE_STAGE_META, type FollowUpBucket } from "@/lib/pipeline-rules";
import { UserCombobox } from "@/components/user-combobox";

const CUSTOMER_STATUSES = Object.keys(STATUS_LABELS) as CustomerStatus[];
const TEMPERATURES = Object.keys(TEMPERATURE_LABELS) as Temperature[];
const LIST_PAGE_SIZE = 50;
const FOLLOW_UP_FILTERS: FollowUpBucket[] = ["OVERDUE", "TODAY", "TOMORROW", "WEEK", "FUTURE", "NONE"];

type RawSearchParams = Record<string, string | undefined>;

export default async function ClientesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const rawFilters = await searchParams;
  const filters = parseCustomerListFilters(rawFilters);
  const page = Math.max(1, Number(rawFilters.page) || 1);
  const session = await auth();
  const user = { id: session!.user.id, role: session!.user.role };
  const isIndividualPortfolio = user.role === "VENDEDOR" || user.role === "REPRESENTANTE";
  const canSeeSeller = !isIndividualPortfolio;
  let where;
  try {
    where = await buildCustomerListWhere(user, filters);
  } catch (error) {
    if (error instanceof CustomerFilterForbiddenError) redirect("/clientes");
    throw error;
  }

  const scope = await getCustomerScopeFilter(user);
  // Retornos agendados vencidos (Reciclagem/"Voltar em"/recompra) entram
  // antes de montar o funil. Consulta indexada e limitada.
  await applyDueStageReturns(scope);

  const visibleSellerIds = await getVisibleSellerIds(user);
  const [sellers, stateRows, spRegionRows, cityRows, originRows, segmentRows, board, customers, totalCount, transferTargets] = await Promise.all([
    canSeeSeller
      ? prisma.user.findMany({
        where: {
          active: true,
          role: { in: ["VENDEDOR", "REPRESENTANTE", "SUPERVISOR"] },
          ...(visibleSellerIds ? { id: { in: visibleSellerIds } } : {}),
        },
        select: {
          id: true, name: true, rca: true, role: true,
          sellerProfile: { select: { displayName: true, representativeType: true } },
          representativeRegions: { select: { state: true, city: true } },
        },
        orderBy: { name: "asc" },
      })
      : Promise.resolve([]),
    prisma.customer.groupBy({ where: { AND: [scope, { state: { not: null } }] }, by: ["state"], orderBy: { state: "asc" } }),
    prisma.customer.groupBy({ where: { AND: [scope, { spRegion: { not: null } }] }, by: ["spRegion"], orderBy: { spRegion: "asc" } }),
    prisma.customer.groupBy({ where: { AND: [scope, { city: { not: null } }] }, by: ["city"], orderBy: { city: "asc" } }),
    prisma.customer.groupBy({ where: { AND: [scope, { leadOrigin: { not: null } }] }, by: ["leadOrigin"], orderBy: { leadOrigin: "asc" } }),
    prisma.customer.groupBy({ where: { AND: [scope, { industrySegment: { not: null } }] }, by: ["industrySegment"], orderBy: { industrySegment: "asc" } }),
    loadPipelineBoard(where),
    prisma.customer.findMany({
      where,
      select: {
        id: true, contactName: true, tradeName: true, legalName: true, cnpjDigits: true, cpfDigits: true, phoneDigits: true, email: true,
        city: true, state: true, spRegion: true, leadOrigin: true, businessType: true, industrySegment: true, interestedBrand: true,
        status: true, temperature: true, pipelineStage: true, cycleContactAttempts: true, lastInteractionAt: true, addressStreet: true,
        seller: { select: { name: true, rca: true, sellerProfile: { select: { displayName: true } } } },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * LIST_PAGE_SIZE,
      take: LIST_PAGE_SIZE,
    }),
    prisma.customer.count({ where }),
    getBulkCustomerTransferTargets(user),
  ]);
  const states = stateRows.flatMap((row) => row.state ? [row.state.toUpperCase()] : []);
  const spRegions = spRegionRows.flatMap((row) => row.spRegion ? [row.spRegion] : []);
  const cities = cityRows.flatMap((row) => row.city ? [row.city] : []);
  const origins = originRows.flatMap((row) => row.leadOrigin ? [row.leadOrigin] : []);
  const segments = segmentRows.flatMap((row) => row.industrySegment ? [row.industrySegment] : []);
  const filterParams = customerFiltersToSearchParams(filters);
  const hasFilters = filterParams.size > 0;
  const serializedFilters = Object.fromEntries(filterParams.entries());
  const sellerOptions = sellers.map((seller) => ({
    id: seller.id, name: seller.sellerProfile?.displayName ?? seller.name, rca: seller.rca, role: seller.role,
    representativeType: seller.sellerProfile?.representativeType ?? null, regions: seller.representativeRegions,
  }));
  const totalPages = Math.max(1, Math.ceil(totalCount / LIST_PAGE_SIZE));
  const pageHref = (target: number) => {
    const params = new URLSearchParams(filterParams);
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `/clientes?${qs}#lista` : "/clientes#lista";
  };
  const quickHref = (extra: Record<string, string>) => `/clientes?${new URLSearchParams({ ...serializedFilters, ...extra })}`;
  const moreFiltersOpen = Boolean(
    filters.status || filters.temperature || filters.state || filters.city || filters.spRegion || filters.leadOrigin || filters.businessType ||
    filters.industrySegment || filters.worksWithSmartwatch !== undefined || filters.interest || filters.interestedBrand || filters.createdFrom ||
    filters.createdTo || filters.address || filters.attempts !== undefined || filters.followUp || filters.repurchase || filters.representativeType ||
    filters.sellerRca || filters.stageChangedFrom || filters.stageChangedTo
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Clientes</h1>
          <p className="text-sm text-gray-500">{totalCount} cliente(s) {hasFilters ? "no filtro" : "na sua carteira"}.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {/* Exportação geral: somente supervisor e admin (também bloqueado no backend). */}
          {canExportCustomers(user.role) && (
            <Link href={`/api/customers/export?${filterParams.toString()}`} className="btn-secondary" prefetch={false}>Exportar clientes</Link>
          )}
          <Link href="/clientes/novo" className="btn-primary">+ Novo cliente</Link>
        </div>
      </div>

      <form className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <input
          type="search"
          name="q"
          defaultValue={filters.q}
          placeholder="Buscar por nome, razão social, CPF, CNPJ, cidade ou RCA..."
          aria-label="Buscar clientes"
          className="input-field sm:col-span-2"
        />
        {canSeeSeller && (
          <UserCombobox options={sellerOptions} value={filters.sellerId ?? ""} name="sellerId" emptyLabel="Todos os vendedores/representantes" ariaLabel="Filtrar por vendedor ou representante" />
        )}
        <select aria-label="Filtrar por etapa" name="stage" defaultValue={filters.stage ?? ""} className="input-field">
          <option value="">Todas as etapas</option>
          {PIPELINE_STAGES.map((stage) => <option key={stage} value={stage}>{PIPELINE_STAGE_META[stage].label}</option>)}
        </select>

        <details className="sm:col-span-2 xl:col-span-4" open={moreFiltersOpen}>
          <summary className="cursor-pointer select-none text-sm font-medium text-gray-600">Mais filtros</summary>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <select aria-label="Filtrar por status" name="status" defaultValue={filters.status ?? ""} className="input-field">
              <option value="">Todos os status</option>
              {CUSTOMER_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
            </select>
            <select aria-label="Filtrar por classificação" name="temperature" defaultValue={filters.temperature ?? ""} className="input-field">
              <option value="">Todas as classificações</option>
              {TEMPERATURES.map((temperature) => <option key={temperature} value={temperature}>{TEMPERATURE_LABELS[temperature]}</option>)}
            </select>
            <select aria-label="Filtrar por número de tentativas" name="attempts" defaultValue={filters.attempts === undefined ? "" : String(filters.attempts)} className="input-field">
              <option value="">Qualquer nº de tentativas</option>
              <option value="0">☆☆☆ Nenhuma tentativa</option>
              <option value="1">★☆☆ 1 tentativa</option>
              <option value="2">★★☆ 2 tentativas</option>
              <option value="3">★★★ 3 ou mais</option>
            </select>
            <select aria-label="Filtrar por follow-up" name="followUp" defaultValue={filters.followUp ?? ""} className="input-field">
              <option value="">Qualquer follow-up</option>
              {FOLLOW_UP_FILTERS.map((bucket) => <option key={bucket} value={bucket}>Follow-up: {FOLLOW_UP_BUCKET_LABELS[bucket].toLowerCase()}</option>)}
            </select>
            {canSeeSeller && (
              <select aria-label="Filtrar por tipo de representante" name="representativeType" defaultValue={filters.representativeType ?? ""} className="input-field">
                <option value="">Todos os tipos de representante</option>
                <option value="ATACADO">Representante Atacado</option>
                <option value="VAREJO">Representante Varejo</option>
                <option value="OUTRO">Representante Outro</option>
              </select>
            )}
            {canSeeSeller && (
              <input aria-label="Filtrar por RCA do responsável" name="sellerRca" defaultValue={filters.sellerRca ?? ""} placeholder="RCA do responsável (ex.: 027)" className="input-field" inputMode="numeric" />
            )}
            <select aria-label="Filtrar por endereço" name="address" defaultValue={filters.address ?? ""} className="input-field">
              <option value="">Com ou sem endereço</option>
              <option value="com">Com endereço</option>
              <option value="sem">Sem endereço</option>
            </select>
            <select aria-label="Filtrar por estado" name="state" defaultValue={filters.state ?? ""} className="input-field">
              <option value="">Todos os estados</option>
              {states.map((state) => <option key={state} value={state}>{state}</option>)}
            </select>
            <input aria-label="Filtrar por cidade" name="city" list="city-options" defaultValue={filters.city ?? ""} placeholder="Cidade" className="input-field" />
            <datalist id="city-options">{cities.map((city) => <option key={city} value={city} />)}</datalist>
            <select aria-label="Filtrar por região de São Paulo" name="spRegion" defaultValue={filters.spRegion ?? ""} className="input-field">
              <option value="">Todas as regiões de SP</option>
              {spRegions.map((region) => <option key={region} value={region}>{region}</option>)}
            </select>
            <select aria-label="Filtrar por origem" name="leadOrigin" defaultValue={filters.leadOrigin ?? ""} className="input-field">
              <option value="">Todas as origens</option>
              {origins.map((origin) => <option key={origin} value={origin}>{origin}</option>)}
            </select>
            <label className="flex items-center gap-2 rounded-md border border-gray-200 px-3 text-sm text-gray-700">
              <input type="checkbox" name="repurchase" value="1" defaultChecked={filters.repurchase} /> Somente recompra
            </label>
            <select aria-label="Filtrar por tipo de negócio" name="businessType" defaultValue={filters.businessType ?? ""} className="input-field">
              <option value="">Todos os tipos de negócio</option>
              {BUSINESS_TYPE_VALUES.filter((value) => value !== "OUTRO").map((value) => <option key={value} value={value}>{BUSINESS_TYPE_LABELS[value]}</option>)}
            </select>
            <select aria-label="Filtrar por segmento" name="industrySegment" defaultValue={filters.industrySegment ?? ""} className="input-field">
              <option value="">Todos os segmentos</option>
              {segments.map((segment) => <option key={segment} value={segment}>{segment}</option>)}
            </select>
            <select aria-label="Filtrar por experiência com smartwatch" name="worksWithSmartwatch" defaultValue={filters.worksWithSmartwatch === undefined ? "" : String(filters.worksWithSmartwatch)} className="input-field">
              <option value="">Trabalha com Smartwatch?</option><option value="true">Sim</option><option value="false">Não</option>
            </select>
            <select aria-label="Filtrar por produto de interesse" name="interest" defaultValue={filters.interest ?? ""} className="input-field">
              <option value="">Todos os interesses</option>
              {CUSTOMER_INTEREST_VALUES.map((value) => <option key={value} value={value}>{CUSTOMER_INTEREST_LABELS[value]}</option>)}
            </select>
            <select aria-label="Filtrar por empresa de interesse" name="interestedBrand" defaultValue={filters.interestedBrand ?? ""} className="input-field">
              <option value="">Todas as empresas de interesse</option>
              {INTERESTED_BRAND_VALUES.map((value) => <option key={value} value={value}>{INTERESTED_BRAND_LABELS[value]}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="Cadastro a partir de" title="Cadastro a partir de" className="input-field" type="date" name="createdFrom" defaultValue={filters.createdFrom ?? ""} />
              <input aria-label="Cadastro até" title="Cadastro até" className="input-field" type="date" name="createdTo" defaultValue={filters.createdTo ?? ""} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="Mudou de etapa a partir de" title="Mudou de etapa a partir de (período)" className="input-field" type="date" name="stageChangedFrom" defaultValue={filters.stageChangedFrom ?? ""} />
              <input aria-label="Mudou de etapa até" title="Mudou de etapa até (período)" className="input-field" type="date" name="stageChangedTo" defaultValue={filters.stageChangedTo ?? ""} />
            </div>
          </div>
        </details>
        <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-4">
          <button className="btn-primary" type="submit">Aplicar filtros</button>
          {hasFilters && <Link className="btn-secondary" href="/clientes">Limpar filtros</Link>}
        </div>
      </form>

      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link className="rounded-full border px-3 py-1 hover:bg-gray-50" href={quickHref({ stage: "INATIVO", sellerId: user.id })}>Meus inativos</Link>
        <Link className="rounded-full border px-3 py-1 hover:bg-gray-50" href={quickHref({ followUp: "OVERDUE" })}>Follow-up vencido</Link>
        <Link className="rounded-full border px-3 py-1 hover:bg-gray-50" href={quickHref({ followUp: "FUTURE" })}>Follow-up futuro</Link>
        <Link className="rounded-full border px-3 py-1 hover:bg-gray-50" href={quickHref({ repurchase: "1" })}>Recompra</Link>
        <Link className="rounded-full border px-3 py-1 hover:bg-gray-50" href={quickHref({ address: "sem" })}>Sem endereço</Link>
      </div>

      <section className="mb-6">
        <div className="mb-3">
          <h2 className="font-semibold text-gray-900">Funil de clientes</h2>
          <p className="text-sm text-gray-500">Arraste o card ou use “⋯” para mudar de etapa. As estrelas mostram as tentativas de contato do ciclo atual. Colunas podem ser recolhidas.</p>
        </div>
        <PipelineBoard
          initialColumns={board}
          filterQuery={filterParams.toString()}
          canSeeSeller={canSeeSeller}
          currentUserId={user.id}
          sellerOptions={sellerOptions}
        />
      </section>

      <BulkTransferControls
        targets={transferTargets}
        filters={serializedFilters}
        visibleCount={customers.length}
        totalCount={totalCount}
      />

      <div id="lista" className="mb-3 mt-6 flex items-center justify-between gap-3">
        <h2 className="font-semibold text-gray-900">Lista de clientes</h2>
        <span className="text-xs text-gray-500">Página {Math.min(page, totalPages)} de {totalPages}</span>
      </div>

      {/* Desktop: tabela */}
      <div className="card hidden overflow-hidden md:block">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="w-10 px-4 py-2 font-medium" aria-label="Selecionar" />
              <th className="px-4 py-2 font-medium">Cliente</th>
              <th className="px-4 py-2 font-medium">Contato</th>
              {canSeeSeller && <th className="px-4 py-2 font-medium">Responsável</th>}
              <th className="px-4 py-2 font-medium">Etapa / status</th>
              <th className="px-4 py-2 font-medium">Classificação</th>
              <th className="px-4 py-2 font-medium">Local / origem</th>
              <th className="px-4 py-2 font-medium">Perfil comercial</th>
              <th className="px-4 py-2 font-medium">Última interação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {customers.map((c) => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 align-top">
                  <input className="customer-bulk-checkbox h-4 w-4" type="checkbox" value={c.id} aria-label={`Selecionar ${c.tradeName || c.contactName}`} />
                </td>
                <td className="px-4 py-3">
                  <Link href={`/clientes/${c.id}`} className="font-medium text-gray-900 hover:text-brand">{c.tradeName || c.contactName}</Link>
                  {c.legalName && <div className="text-xs text-gray-500">{c.legalName}</div>}
                  <div className="text-xs text-gray-500">{formatCnpjOrCpf(c.cnpjDigits || c.cpfDigits)}</div>
                </td>
                <td className="px-4 py-3 text-gray-600">
                  <div>{c.contactName}</div>
                  <div className="text-xs">{formatPhone(c.phoneDigits)}</div>
                  <div className="mt-1 flex gap-2 text-xs">
                    {c.phoneDigits && <a className="font-medium text-emerald-600 hover:underline" href={`https://wa.me/${c.phoneDigits.startsWith("55") ? c.phoneDigits : `55${c.phoneDigits}`}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                    {c.email && <a className="font-medium text-blue-600 hover:underline" href={`mailto:${c.email}`}>E-mail</a>}
                  </div>
                </td>
                {canSeeSeller && (
                  <td className="px-4 py-3 text-gray-600">
                    {c.seller.sellerProfile?.displayName ?? c.seller.name}
                    {c.seller.rca && <div className="text-xs text-gray-400">RCA {c.seller.rca}</div>}
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="text-xs font-medium text-gray-700">{PIPELINE_STAGE_META[c.pipelineStage].label} <span className="text-amber-500" title="Tentativas no ciclo">{"★".repeat(attemptStars(c.cycleContactAttempts).filled)}</span></div>
                  <div className="mt-1"><StatusBadge status={c.status} /></div>
                </td>
                <td className="px-4 py-3"><TemperatureBadge temperature={c.temperature} /></td>
                <td className="px-4 py-3 text-gray-600">
                  <div>{[c.city, c.state].filter(Boolean).join("/") || "—"}</div>
                  {!c.addressStreet && <div className="text-xs text-gray-400">Sem endereço</div>}
                  {c.spRegion && <div className="text-xs text-gray-500">{c.spRegion}</div>}
                  {c.leadOrigin && <div className="text-xs text-gray-400">{c.leadOrigin}</div>}
                </td>
                <td className="px-4 py-3 text-gray-600">
                  <div>{c.businessType ? BUSINESS_TYPE_LABELS[c.businessType] : "—"}</div>
                  <div className="text-xs text-gray-400">{c.industrySegment || (c.interestedBrand ? INTERESTED_BRAND_LABELS[c.interestedBrand] : "")}</div>
                </td>
                <td className="px-4 py-3 text-gray-500">{formatDate(c.lastInteractionAt)}</td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={canSeeSeller ? 9 : 8} className="px-4 py-8 text-center text-gray-400">Nenhum cliente encontrado.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile: cards */}
      <div className="space-y-3 md:hidden">
        {customers.map((c) => (
          <div key={c.id} className="card flex items-start gap-3 p-4">
            <input className="customer-bulk-checkbox mt-1 h-4 w-4 shrink-0" type="checkbox" value={c.id} aria-label={`Selecionar ${c.tradeName || c.contactName}`} />
            <div className="min-w-0 flex-1">
              <Link href={`/clientes/${c.id}`} className="block active:bg-gray-50">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-gray-900">{c.tradeName || c.contactName}</p>
                    {c.legalName && <p className="text-xs text-gray-500">{c.legalName}</p>}
                    {c.tradeName && c.contactName !== c.tradeName && <p className="text-xs text-gray-400">Contato: {c.contactName}</p>}
                    {(c.city || c.state) && <p className="mt-1 text-xs text-gray-400">{[c.city, c.state].filter(Boolean).join("/")}</p>}
                    {canSeeSeller && <p className="text-xs text-gray-400">{c.seller.sellerProfile?.displayName ?? c.seller.name}{c.seller.rca ? ` · RCA ${c.seller.rca}` : ""}</p>}
                  </div>
                  <TemperatureBadge temperature={c.temperature} />
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-gray-700">{PIPELINE_STAGE_META[c.pipelineStage].label}</span>
                  <StatusBadge status={c.status} />
                </div>
              </Link>
              <div className="mt-3 flex gap-2">
                {c.phoneDigits && <a className="btn-secondary flex-1 text-center" href={`https://wa.me/${c.phoneDigits.startsWith("55") ? c.phoneDigits : `55${c.phoneDigits}`}`} target="_blank" rel="noreferrer">WhatsApp</a>}
                {c.email && <a className="btn-secondary flex-1 text-center" href={`mailto:${c.email}`}>E-mail</a>}
              </div>
            </div>
          </div>
        ))}
        {customers.length === 0 && <p className="py-8 text-center text-gray-400">Nenhum cliente encontrado.</p>}
      </div>

      {totalPages > 1 && (
        <nav className="mt-4 flex items-center justify-center gap-2 text-sm" aria-label="Paginação da lista">
          {page > 1 && <Link className="btn-secondary" href={pageHref(page - 1)}>← Anterior</Link>}
          <span className="text-gray-500">{Math.min(page, totalPages)} / {totalPages}</span>
          {page < totalPages && <Link className="btn-secondary" href={pageHref(page + 1)}>Próxima →</Link>}
        </nav>
      )}
    </div>
  );
}
