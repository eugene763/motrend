# Deploy

## Prod

```bash
./deploy-prod.sh
```

## If `refreshJobStatus` fails with "Unable to set the invoker"

Deploy can succeed for other functions but fail to set IAM for the callable. Fix once (needs `roles/run.admin` or project owner):

```bash
gcloud functions add-invoker-policy-binding refreshJobStatus \
  --region=us-central1 \
  --member=allUsers
```

Then redeploy only functions if needed, or leave as is — the function may already be invokable.
