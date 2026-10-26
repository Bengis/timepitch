# AI crew job on Azure Container Apps

The match report crew (`backend/src/timepitch/crew`) runs as an event-driven Azure Container Apps job:

```text
web app ──append──▶ Storage queue "crew-requests" ──KEDA azure-queue──▶ Container Apps job (crew)
                                                                        │  Microsoft Agent Framework workflow
                                                                        │  analyst → writer → verifier (→ one revision)
                                                                        ▼
                                                     Azure AI Foundry (gpt-4.1-mini, Entra token)
                                                                        │
web app ◀──read── Blob container "reports" (sealed report) ◀────────────┘   ledger of every model call in "ledger"
```

## Files

- `Dockerfile`: the job image (crew dependency groups only, non-root user).
- `job.yaml`: the job definition with the KEDA `azure-queue` rule, managed identity and scale to zero.

## Identity and permissions (least privilege)

The job uses its **system-assigned managed identity** for everything, so there are no keys or connection strings.

| Role | Scope |
| --- | --- |
| Cognitive Services OpenAI User | the Azure AI Foundry / Azure OpenAI account |
| Storage Queue Data Message Processor | queue `crew-requests` |
| Storage Blob Data Contributor | containers `reports` and `ledger` |
| AcrPull | the container registry |

The public web app does not get an identity on the storage account. It holds two narrow SAS tokens that expire with
the demo: **add-only** on the queue and **read/list-only** on `reports`. It cannot read the ledger, change a report or
call the model. Every report it reads is re-checked on the server (seal, versions, verifier) before it is shown.

## Spending envelope

Every request carries a spending envelope: a maximum number of reports, a maximum cost in USD, the languages and an
expiry. The job only accepts envelopes whose sha256 is in `TIMEPITCH_CREW_ALLOWED_ENVELOPES`. Each model call is
reserved in the ledger before it is sent and confirmed after, so a crash never re-sends a paid call.

## Deploy

```bash
# image (remote build, no local Docker needed)
git archive HEAD | az acr build -r <registry> -t timepitch-crew:<tag> -f deploy/crew/Dockerfile -
# job
az containerapp job create -g <rg> -n timepitch-crew-job --yaml deploy/crew/job.yaml
PRINCIPAL=$(az containerapp job show -g <rg> -n timepitch-crew-job --query identity.principalId -o tsv)
az role assignment create --assignee "$PRINCIPAL" --role "Cognitive Services OpenAI User" --scope <foundry-account-id>
az role assignment create --assignee "$PRINCIPAL" --role "Storage Queue Data Message Processor" --scope <storage-id>/queueServices/default/queues/crew-requests
az role assignment create --assignee "$PRINCIPAL" --role "Storage Blob Data Contributor" --scope <storage-id>/blobServices/default/containers/reports
az role assignment create --assignee "$PRINCIPAL" --role "Storage Blob Data Contributor" --scope <storage-id>/blobServices/default/containers/ledger
az role assignment create --assignee "$PRINCIPAL" --role "AcrPull" --scope <registry-id>
```

The web app image and its entrypoint are in [`../azure-app`](../azure-app).
