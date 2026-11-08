"""Reproducible account-holdout evaluation of peer-matching heuristics.

python scripts/evaluate_peer_parameters.py --input SNAPSHOT.csv --output REPORT_DIR
Selection: lowest validation spending sMAPE among configurations covering >=90%
of all validation accounts, >=75% with loans, and >=90% without loans. A separate
account test set is evaluated once after selection. This is a benchmark-quality
proxy, not evidence that above-median spending is unnecessary or safely cuttable.
"""
import argparse,csv,hashlib,itertools,json,warnings
from pathlib import Path
import numpy as np

FEATURES=['income','fixed_costs','loan_payment']
OUTCOMES=['spending','household_bills','cash_withdrawals','card_withdrawals','transfers_out_other']
SEED=20261108
DEFAULT=dict(income_tolerance=.30,fixed_tolerance=.40,loan_tolerance=.40,cost_floor=200,maximum_peers=50,minimum_peers=10)


def cohort_arrays(targets,references,config,mode='full'):
    scales=np.column_stack([np.maximum(targets[:,0]*config['income_tolerance'],1),
        np.maximum(targets[:,1]*config['fixed_tolerance'],max(config['cost_floor'],1e-9)),
        np.maximum(targets[:,2]*config['loan_tolerance'],max(config['cost_floor'],1e-9))])
    d=np.abs(targets[:,None,:3]-references[None,:,:3])/scales[:,None,:]
    dimensions=1 if mode=='income_only' else 3
    mask=(d[:,:,:dimensions]<=1).all(axis=2)&((targets[:,None,2]>0)==(references[None,:,2]>0))
    # Last column is account ID; exclude self even for full-dataset diagnostics.
    mask&=targets[:,None,-1]!=references[None,:,-1]
    distance=(d[:,:,:dimensions]**2).sum(axis=2)
    distance[~mask]=np.inf
    cap=min(100,len(references))
    idx=np.argpartition(distance,cap-1,axis=1)[:,:cap]
    picked=np.take_along_axis(distance,idx,axis=1)
    order=np.lexsort((references[idx,-1],picked),axis=1)
    idx=np.take_along_axis(idx,order,axis=1)
    return idx,mask.sum(axis=1),np.take_along_axis(distance,idx,axis=1)


def prediction(targets,references,config,arrays=None,mode='full'):
    idx,count,dist=arrays if arrays is not None else cohort_arrays(targets,references,config,mode)
    k=config['maximum_peers'];idx=idx[:,:k];dist=dist[:,:k]
    values=references[idx,3:8].copy()
    values[~np.isfinite(dist)]=np.nan
    with warnings.catch_warnings():
        warnings.simplefilter('ignore',RuntimeWarning)
        pred=np.nanmedian(values,axis=1)
    covered=count>=config['minimum_peers']
    pred[~covered]=np.nan
    return pred,covered,np.minimum(count,k),idx


def smape(actual,pred):return 2*np.abs(actual-pred)/(np.abs(actual)+np.abs(pred)+1e-9)


def summarize(targets,pred,covered,counts):
    def fraction(mask):return float(covered[mask].mean()) if mask.any() else None
    loan=targets[:,2]>0
    out={'coverage':float(covered.mean()),'loan_coverage':fraction(loan),'no_loan_coverage':fraction(~loan),
         'covered_accounts':int(covered.sum()),'total_accounts':len(targets),
         'median_cohort_size':float(np.median(counts[covered])) if covered.any() else None}
    for j,key in enumerate(OUTCOMES):
        a=targets[covered,3+j];p=pred[covered,j]
        out[key+'_smape_pct']=float(smape(a,p).mean()*100) if len(a) else None
        out[key+'_mae_dollars']=float(np.abs(a-p).mean()) if len(a) else None
        out[key+'_log_mae']=float(np.abs(np.log1p(a)-np.log1p(p)).mean()) if len(a) else None
    return out


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',required=True,type=Path);parser.add_argument('--output',required=True,type=Path)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    with args.input.open() as f:raw=list(csv.DictReader(f))
    raw.sort(key=lambda r:int(r['account_id']))
    columns=FEATURES+OUTCOMES+['account_id']
    data=np.array([[float(row[k]) for k in columns] for row in raw])
    if not np.isfinite(data).all() or (data[:,:8]<0).any():raise ValueError('Snapshot contains missing, non-finite or negative matching/outcome metrics')
    if len(set(data[:,-1]))!=len(data):raise ValueError('Duplicate account IDs')
    rng=np.random.default_rng(SEED)
    permutation=rng.permutation(len(data));n_train=int(len(data)*.6);n_validation=int(len(data)*.2)
    reference=data[permutation[:n_train]];validation=data[permutation[n_train:n_train+n_validation]];test=data[permutation[n_train+n_validation:]]
    defaults=prediction(validation,reference,DEFAULT)
    default_validation=summarize(validation,*defaults[:3])
    results=[]
    for income in [.1,.2,.3,.4,.5]:
        for fixed,loan,floor in itertools.product([.2,.4,.6],[.2,.4,.6],[0,200,400]):
            base=dict(income_tolerance=income,fixed_tolerance=fixed,loan_tolerance=loan,cost_floor=floor)
            arrays=cohort_arrays(validation,reference,base)
            for maximum in [20,50,100]:
                for minimum in [10,20]:
                    config={**base,'maximum_peers':maximum,'minimum_peers':minimum}
                    pred,covered,count,_=prediction(validation,reference,config,arrays)
                    metrics=summarize(validation,pred,covered,count)
                    results.append({**config,**metrics})
        print(f'Completed income tolerance {income:.0%}; {len(results)} configurations',flush=True)
    feasible=[r for r in results if r['coverage']>=.90 and r['loan_coverage']>=.75 and r['no_loan_coverage']>=.90]
    if not feasible:raise RuntimeError('No grid configuration met preregistered coverage constraints; do not select a lower-coverage winner silently')
    feasible.sort(key=lambda r:(r['spending_smape_pct'],-r['minimum_peers'],r['maximum_peers'],r['income_tolerance'],r['fixed_tolerance'],r['loan_tolerance'],r['cost_floor']))
    chosen={k:feasible[0][k] for k in DEFAULT}
    comparison={}
    predictions={}
    for label,config,mode in [('original',DEFAULT,'full'),('selected',chosen,'full'),('income_only',{**DEFAULT,'maximum_peers':50},'income_only')]:
        pred,covered,count,idx=prediction(test,reference,config,mode=mode)
        comparison[label]={'parameters':config,**summarize(test,pred,covered,count)}
        predictions[label]=(pred,covered,count,idx)
    # Paired evaluation on the same covered accounts avoids comparing different subsets.
    common=predictions['original'][1]&predictions['selected'][1]
    baseline_errors=smape(test[common,3],predictions['original'][0][common,0])
    selected_errors=smape(test[common,3],predictions['selected'][0][common,0])
    difference=selected_errors-baseline_errors
    bootstrap_rng=np.random.default_rng(SEED+1)
    bootstrap=np.array([bootstrap_rng.choice(difference,size=len(difference),replace=True).mean()*100 for _ in range(2000)])
    paired={'accounts':int(common.sum()),'original_spending_smape_pct':float(baseline_errors.mean()*100),
            'selected_spending_smape_pct':float(selected_errors.mean()*100),
            'selected_minus_original_percentage_points':float(difference.mean()*100),
            'bootstrap_95pct_interval_percentage_points':np.quantile(bootstrap,[.025,.975]).tolist(),
            'bootstrap_repetitions':2000}
    # Repeatability of peer medians under cohort resampling (not confidence about affordability).
    stability={}
    for label in ['original','selected']:
        pred,covered,count,idx=predictions[label]
        widths=[];rr=np.random.default_rng(SEED+2)
        for i in np.flatnonzero(covered):
            values=reference[idx[i,:count[i]],3]
            draws=np.median(rr.choice(values,size=(200,len(values)),replace=True),axis=1)
            widths.append((np.quantile(draws,.975)-np.quantile(draws,.025))/max(pred[i,0],1)*100)
        stability[label]={'median_relative_95pct_bootstrap_width_pct':float(np.median(widths)), 'resamples_per_cohort':200}
    full={}
    for label,config in [('original',DEFAULT),('selected',chosen)]:
        # Batch targets to bound memory while evaluating all 4,500 users against all other users.
        stats=[];cohorts={}
        for start in range(0,len(data),300):
            targets=data[start:start+300];p,c,count,idx=prediction(targets,data,config)
            stats.append((targets,p,c,count))
            for account in [20111,20133,20134]:
                match=np.flatnonzero(targets[:,-1]==account)
                if len(match):cohorts[str(account)]={'peer_count':int(count[match[0]]),'covered':bool(c[match[0]])}
        full[label]={**summarize(np.concatenate([x[0] for x in stats]),np.concatenate([x[1] for x in stats]),np.concatenate([x[2] for x in stats]),np.concatenate([x[3] for x in stats])), 'example_accounts':cohorts}
    summary={'seed':SEED,'snapshot_sha256':hashlib.sha256(args.input.read_bytes()).hexdigest(),
        'accounts':len(data),'split':{'reference':len(reference),'validation':len(validation),'test':len(test)},
        'grid_configurations':len(results),'feasible_configurations':len(feasible),
        'selection_rule':'Minimize validation total-spending sMAPE with >=90% overall, >=75% loan, >=90% no-loan coverage. Ties prefer larger minimum cohorts, then smaller maximum cohorts.',
        'original_validation':default_validation,'selected_validation':feasible[0],
        'test':comparison,'paired_test':paired,'bootstrap_stability':stability,'full_dataset':full,
        'top_validation':feasible[:10],
        'limitations':['No labels for unnecessary spending or safe cuts exist.','Evaluation predicts account-level historical spending; it does not validate recommendations.','Split is by account, not by future time. Household context is unavailable.','Thresholds and objective are product decisions. Best tested does not mean globally optimal.','Only one seeded account split was used; uncertainty intervals are conditional on that split.']}
    (args.output/'summary.json').write_text(json.dumps(summary,indent=2))
    with (args.output/'validation_grid.csv').open('w',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=list(results[0]));writer.writeheader();writer.writerows(results)
    np.savez_compressed(args.output/'split_account_ids.npz',reference=reference[:,-1].astype(int),validation=validation[:,-1].astype(int),test=test[:,-1].astype(int))
    print(json.dumps({'selected':chosen,'paired_test':paired,'full_dataset_coverage':{k:v['coverage'] for k,v in full.items()}},indent=2),flush=True)

if __name__=='__main__':main()
